import Foundation
import LiveStageModels

#if canImport(UIKit)
import UIKit
#endif

/// The actor that owns all shared SDK state (build spec §5.2): configuration access, the API client,
/// the per-session applied version, stale windows, deep-link URLs, and the per-session polling tasks.
/// Every public `LiveStage` call funnels through here, so the mutable state is serialized by the actor.
actor LiveStageRuntime {
    private let config: ConfigStore
    private let pollInterval: TimeInterval
    private let cache: LocalCache
    private let urlSession: URLSession
    private let apiMaxAttempts: Int

    private var configCache: [String: TemplateConfiguration] = [:]
    private var appliedVersions: [String: Int] = [:]
    private var staleAfterSeconds: [String: Int] = [:]
    private var deepLinkURLs: [String: String] = [:]            // sessionId -> composed primary URL
    private var sessionTemplates: [String: String] = [:]
    private var pollTasks: [String: Task<Void, Never>] = [:]
    private var lastAppliedContent: [String: LiveStageContentState] = [:]   // for the countdown zero-transition
    private var zeroTransitionTasks: [String: Task<Void, Never>] = [:]

    /// The analytics pipeline (build spec §4.8/§5.2). Lazily built so it resolves the persisted
    /// installationId only when analytics first run; it reads the same ConfigStore for uploads.
    private lazy var pipeline = EventPipeline(config: config)
    private var observersConfigured = false

    #if os(iOS)
    private let bridge = ActivityBridge()
    /// Token for the foreground notification observer, removed on deinit so it can't leak.
    private var foregroundObserver: NSObjectProtocol?
    #endif

    init(
        config: ConfigStore,
        pollInterval: TimeInterval = 8,
        cache: LocalCache = FileLocalCache(),
        urlSession: URLSession = .shared,
        apiMaxAttempts: Int = 4
    ) {
        self.config = config
        self.pollInterval = pollInterval
        self.cache = cache
        self.urlSession = urlSession
        self.apiMaxAttempts = apiMaxAttempts
    }

    deinit {
        #if os(iOS)
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
        #endif
    }

    private func apiClient() throws -> APIClient {
        let (apiKey, baseURL) = try config.current()
        return APIClient(baseURL: baseURL, apiKey: apiKey, maxAttempts: apiMaxAttempts, session: urlSession)
    }

    /// Whether an error is a transport failure (offline), so the caller can fall back to the local
    /// cache (build spec §5.4). Server-rejection errors (validation/lifecycle/decoding) are not.
    private static func isNetworkError(_ error: Error) -> Bool {
        if case LiveStageError.network = error { return true }
        return false
    }

    // MARK: - Configuration

    func configuration(for templateId: String) async throws -> TemplateConfiguration {
        if let cached = configCache[templateId] { return cached }
        do {
            // Network up: the fresh config always wins and refreshes the durable cache (§4.4 immutability
            // is per running activity; fetchConfiguration still returns the latest authored config).
            let config = try await apiClient().fetchConfiguration(templateId: templateId)
            configCache[templateId] = config
            cache.putConfig(config)
            return config
        } catch {
            // Offline (§5.4): serve the last known config from the durable cache. Re-throw the original
            // error if there is nothing cached, or if the failure was not a transport failure.
            if Self.isNetworkError(error), let cached = cache.config(for: templateId) {
                configCache[templateId] = cached
                return cached
            }
            throw error
        }
    }

    private func cacheSession(_ sessionId: String, state: LiveStageContentState, status: String) {
        cache.putSession(CachedSession(
            sessionId: sessionId,
            state: state,
            status: status,
            staleAfterSeconds: staleAfterSeconds[sessionId] ?? 900
        ))
    }

    // MARK: - Start

    func start(
        templateId: String,
        deepLinkParameters: [String: String],
        state: TemplatePayload
    ) async throws -> LiveStageSession {
        configureObserversIfNeeded()
        let api = try apiClient()
        let config = try await configuration(for: templateId)

        // Don't create a server session we can't render: bail before `start` if Live Activities are off.
        #if os(iOS)
        guard bridge.areActivitiesEnabled else { throw LiveStageError.activityKitUnavailable }
        #else
        throw LiveStageError.activityKitUnavailable
        #endif

        let resp = try await api.start(
            templateId: templateId,
            deepLinkParameters: deepLinkParameters,
            payload: state,
            idempotencyKey: UUID().uuidString
        )

        #if os(iOS)
        guard let deepLinkURL = URL(string: resp.deepLinkURL) else {
            // The server composed a URL we can't parse — clean up the orphan session and fail.
            try? await api.end(sessionId: resp.sessionId, reason: "invalid_deep_link_url")
            throw LiveStageError.server(status: 0, message: "Server returned an invalid deepLinkURL: \(resp.deepLinkURL)")
        }
        let contentState = LiveStageContentState(
            payload: state,
            metadata: StateMetadata(lastUpdatedAt: resp.lastUpdatedAt, version: resp.version)
        )
        let staleDate = resp.lastUpdatedAt.addingTimeInterval(TimeInterval(resp.staleAfterSeconds))
        let attributes = LiveStageActivityAttributes(
            sessionId: resp.sessionId,
            templateId: config.templateId,
            templateType: config.templateType,
            iconIdentifier: config.icon,
            accentStyle: config.accentStyle,
            labels: config.labels,
            deepLinkURL: deepLinkURL
        )
        do {
            try bridge.request(attributes: attributes, state: contentState, staleDate: staleDate)
        } catch {
            // Orphan-session compensation (build spec §5.1): the server session exists but no activity
            // appeared on the device — end it with a reason, then rethrow the original error.
            try? await api.end(sessionId: resp.sessionId, reason: "activitykit_request_failed")
            throw error
        }
        lastAppliedContent[resp.sessionId] = contentState
        scheduleZeroTransition(sessionId: resp.sessionId)
        // Seed the durable cache so status() can answer offline and the last state is retained (§5.4).
        cache.putSession(CachedSession(
            sessionId: resp.sessionId, state: contentState, status: "active",
            staleAfterSeconds: resp.staleAfterSeconds
        ))
        #endif

        appliedVersions[resp.sessionId] = resp.version
        staleAfterSeconds[resp.sessionId] = resp.staleAfterSeconds
        deepLinkURLs[resp.sessionId] = resp.deepLinkURL
        sessionTemplates[resp.sessionId] = templateId
        startPolling(sessionId: resp.sessionId)
        // The activity is now requested and rendering — record the start (no version: the initial
        // start state is shown via Activity.request and never produces a state_applied ack, §8.6).
        await pipeline.record(.activityStarted, sessionId: resp.sessionId, templateId: templateId)
        return LiveStageSession(sessionId: resp.sessionId, templateId: templateId)
    }

    // MARK: - Update (app-originated: apply immediately, do not wait for the poll)

    func update(_ session: LiveStageSession, state: TemplatePayload) async throws {
        let api = try apiClient()
        let templateId = sessionTemplates[session.sessionId] ?? session.templateId
        // One clientMutationId per public update call, reused across the APIClient's retries.
        let resp: UpdateResponse
        do {
            resp = try await api.update(
                sessionId: session.sessionId,
                clientMutationId: UUID().uuidString,
                payload: state
            )
        } catch {
            // sync_failed is narrow (§4.8/§8.6): only transport/server failures, never a server-rejected
            // update (validation/lifecycle), which the server already counts in rejected_updates.
            if let reason = SyncFailureClassifier.failureReason(for: error) {
                await pipeline.record(.syncFailed, sessionId: session.sessionId, templateId: templateId, metadata: ["reason": reason])
            }
            throw error
        }
        let staleSecs = staleAfterSeconds[session.sessionId] ?? 900
        let staleDate = resp.lastUpdatedAt.addingTimeInterval(TimeInterval(staleSecs))
        #if os(iOS)
        await bridge.update(sessionId: session.sessionId, state: resp.state, staleDate: staleDate)
        lastAppliedContent[session.sessionId] = resp.state
        scheduleZeroTransition(sessionId: session.sessionId)
        // Acknowledge the device application (build spec §9): the server computes acknowledged sync
        // latency from this. Only on a genuine forward apply (version >= 2) — never v1, never the
        // zero-transition (which re-applies the same version).
        await pipeline.record(.stateApplied, sessionId: session.sessionId, templateId: templateId, version: resp.version)
        #endif
        appliedVersions[session.sessionId] = resp.version
        cacheSession(session.sessionId, state: resp.state, status: "active")
    }

    // MARK: - End (idempotent server-side; stops polling and finalizes the activity)

    func end(_ session: LiveStageSession) async throws {
        let api = try apiClient()
        let templateId = sessionTemplates[session.sessionId] ?? session.templateId
        try await api.end(sessionId: session.sessionId, reason: nil)
        stopPolling(sessionId: session.sessionId)
        #if os(iOS)
        await bridge.end(sessionId: session.sessionId)
        #endif
        await pipeline.record(.activityEnded, sessionId: session.sessionId, templateId: templateId)
        // Reflect the terminal lifecycle in the durable cache before dropping the in-memory state.
        if let existing = cache.session(for: session.sessionId) {
            cache.putSession(CachedSession(
                sessionId: existing.sessionId, state: existing.state, status: "ended",
                staleAfterSeconds: existing.staleAfterSeconds
            ))
        }
        clearSession(session.sessionId)
    }

    // MARK: - Status

    func status(_ session: LiveStageSession) async throws -> SessionStatus {
        do {
            let resp = try await apiClient().get(sessionId: session.sessionId)
            return SessionStatus(
                status: try LifecycleStatus(serverStatus: resp.status),
                version: resp.version,
                lastUpdatedAt: resp.lastUpdatedAt
            )
        } catch {
            // Offline (§5.4): answer from the durable cache. Re-throw if there is nothing cached, or
            // if the failure was not a transport failure (a real 404/decoding error must surface).
            if Self.isNetworkError(error), let cached = cache.session(for: session.sessionId) {
                return SessionStatus(
                    status: try LifecycleStatus(serverStatus: cached.status),
                    version: cached.state.metadata.version,
                    lastUpdatedAt: cached.state.metadata.lastUpdatedAt
                )
            }
            throw error
        }
    }

    // MARK: - Deep links

    /// Parses a tapped URL, matches it to a known session by its (source-stripped) composed deep link,
    /// records the interaction event, and returns routing info. Strict source handling (build spec
    /// §4.8/§5.2): `activity_open` records `activity_opened`, `expanded_action` records
    /// `expanded_action_tapped` (with `metadata.source=expanded_action`), and a missing/unknown source
    /// records nothing — an arbitrary source-less link is never classified as a Live Activity open.
    /// Returns nil for a URL that matches no known LiveStage session.
    func handleDeepLink(_ url: URL) async throws -> LiveStageRoute? {
        guard let parsed = DeepLink.parse(url) else { return nil }
        let tapped = strippingSource(url)
        guard let sessionId = deepLinkURLs.first(where: { $0.value == tapped })?.key else { return nil }
        let templateId = sessionTemplates[sessionId] ?? ""

        let source: InteractionSource
        switch parsed.interaction {
        case .activityOpen:
            await pipeline.record(.activityOpened, sessionId: sessionId, templateId: templateId)
            source = .primary
        case .expandedAction:
            await pipeline.record(.expandedActionTapped, sessionId: sessionId, templateId: templateId, metadata: ["source": "expanded_action"])
            source = .expandedAction
        case .unspecified:
            source = .primary   // routable for navigation, but not recorded as an interaction
        }
        return LiveStageRoute(sessionId: sessionId, parameters: parsed.parameters, source: source)
    }

    // MARK: - Dismissal observation (best-effort, build spec §4.8/§8.5)

    /// Wires the ActivityKit dismissal callback once (the actor isn't fully initialized at `init`, so
    /// this runs lazily on the first `start`). Best-effort only: a dismissal is observable solely
    /// while the app runs, so this is never a guaranteed-dismissal count.
    private func configureObserversIfNeeded() {
        guard !observersConfigured else { return }
        observersConfigured = true
        #if os(iOS)
        bridge.onDismissed = { [weak self] sessionId in
            Task { await self?.recordDismissal(sessionId: sessionId) }
        }
        // Upload-on-reconnect (build spec §5.4 acceptance): when the app returns to the foreground,
        // flush any events that queued while offline. The flush is single-flight, so this can't race
        // a poll-triggered flush. The token is removed on deinit so the observer can't leak.
        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil
        ) { [weak self] _ in
            Task { await self?.flushPendingEvents() }
        }
        #endif
    }

    private func flushPendingEvents() async {
        await pipeline.flush()
    }

    private func recordDismissal(sessionId: String) async {
        guard let templateId = sessionTemplates[sessionId] else { return }
        await pipeline.record(.dismissalObserved, sessionId: sessionId, templateId: templateId)
    }

    // MARK: - Polling (one cancellable task per active session, cancelled on end)

    private func startPolling(sessionId: String) {
        pollTasks[sessionId]?.cancel()
        let interval = pollInterval
        pollTasks[sessionId] = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                if Task.isCancelled { break }
                await self?.pollOnce(sessionId: sessionId)
            }
        }
    }

    private func stopPolling(sessionId: String) {
        pollTasks[sessionId]?.cancel()
        pollTasks.removeValue(forKey: sessionId)
    }

    /// Polls one session. Network failures leave the last state on screen to go stale (no throw).
    /// Portal/backend-originated changes (a higher version) are applied forward-only.
    private func pollOnce(sessionId: String) async {
        guard let api = try? apiClient(), let resp = try? await api.get(sessionId: sessionId) else { return }
        if resp.status == "ended" {
            stopPolling(sessionId: sessionId)
            return
        }
        let applied = appliedVersions[sessionId] ?? 0
        guard SyncDecision.shouldApply(incoming: resp.version, applied: applied) else { return }
        let staleSecs = staleAfterSeconds[sessionId] ?? resp.staleAfterSeconds
        let staleDate = resp.lastUpdatedAt.addingTimeInterval(TimeInterval(staleSecs))
        #if os(iOS)
        await bridge.update(sessionId: sessionId, state: resp.state, staleDate: staleDate)
        lastAppliedContent[sessionId] = resp.state
        scheduleZeroTransition(sessionId: sessionId)
        // A portal/backend-originated forward apply is also acknowledged (server-clock latency, §9).
        await pipeline.record(.stateApplied, sessionId: sessionId, templateId: sessionTemplates[sessionId] ?? "", version: resp.version)
        #endif
        appliedVersions[sessionId] = resp.version
        cacheSession(sessionId, state: resp.state, status: "active")
    }

    private func clearSession(_ sessionId: String) {
        appliedVersions.removeValue(forKey: sessionId)
        staleAfterSeconds.removeValue(forKey: sessionId)
        deepLinkURLs.removeValue(forKey: sessionId)
        sessionTemplates.removeValue(forKey: sessionId)
        lastAppliedContent.removeValue(forKey: sessionId)
        zeroTransitionTasks[sessionId]?.cancel()
        zeroTransitionTasks.removeValue(forKey: sessionId)
    }

    // MARK: - Countdown zero-transition (a single local re-render at the target, no per-second pushes)

    #if os(iOS)
    /// Schedules ONE local re-render at a Countdown's `targetDate`. The renderer flips from the system
    /// countdown to `zeroStateLabel` only when its enclosing SwiftUI branch is re-evaluated, and that
    /// branch is NOT re-evaluated on its own when `Text(timerInterval:)` reaches zero (verified in the
    /// M2 simulator spike). So at the target we re-apply the current content once via `Activity.update`,
    /// forcing the re-render. This is a single semantic transition — never a per-second update — and
    /// makes no server call. Re-scheduled whenever new content is applied (the target can change); a
    /// no-op for non-countdown payloads or a target already in the past.
    private func scheduleZeroTransition(sessionId: String) {
        zeroTransitionTasks[sessionId]?.cancel()
        zeroTransitionTasks.removeValue(forKey: sessionId)
        guard let content = lastAppliedContent[sessionId],
              case .countdown(let state) = content.payload else { return }
        let interval = state.targetDate.timeIntervalSinceNow
        guard interval > 0 else { return }   // already at/after zero: the applied content already shows it
        zeroTransitionTasks[sessionId] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            if Task.isCancelled { return }
            await self?.fireZeroTransition(sessionId: sessionId)
        }
    }

    /// Re-pushes the current content so ActivityKit re-renders; the renderer's `targetDate > now`
    /// branch now takes the `zeroStateLabel` path. No version bump, no network.
    private func fireZeroTransition(sessionId: String) async {
        zeroTransitionTasks.removeValue(forKey: sessionId)
        guard let content = lastAppliedContent[sessionId] else { return }
        let staleSecs = staleAfterSeconds[sessionId] ?? 900
        let staleDate = content.metadata.lastUpdatedAt.addingTimeInterval(TimeInterval(staleSecs))
        await bridge.update(sessionId: sessionId, state: content, staleDate: staleDate)
    }
    #endif

    private func strippingSource(_ url: URL) -> String {
        guard var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url.absoluteString }
        let filtered = (comps.queryItems ?? []).filter { $0.name != "source" }
        comps.queryItems = filtered.isEmpty ? nil : filtered
        return comps.string ?? url.absoluteString
    }
}
