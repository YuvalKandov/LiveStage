import Foundation
import LiveStageModels

/// The actor that owns all shared SDK state (build spec §5.2): configuration access, the API client,
/// the per-session applied version, stale windows, deep-link URLs, and the per-session polling tasks.
/// Every public `LiveStage` call funnels through here, so the mutable state is serialized by the actor.
actor LiveStageRuntime {
    private let config: ConfigStore
    private let pollInterval: TimeInterval

    private var configCache: [String: TemplateConfiguration] = [:]
    private var appliedVersions: [String: Int] = [:]
    private var staleAfterSeconds: [String: Int] = [:]
    private var deepLinkURLs: [String: String] = [:]            // sessionId -> composed primary URL
    private var sessionTemplates: [String: String] = [:]
    private var pollTasks: [String: Task<Void, Never>] = [:]
    private var lastAppliedContent: [String: LiveStageContentState] = [:]   // for the countdown zero-transition
    private var zeroTransitionTasks: [String: Task<Void, Never>] = [:]

    #if os(iOS)
    private let bridge = ActivityBridge()
    #endif

    init(config: ConfigStore, pollInterval: TimeInterval = 8) {
        self.config = config
        self.pollInterval = pollInterval
    }

    private func apiClient() throws -> APIClient {
        let (apiKey, baseURL) = try config.current()
        return APIClient(baseURL: baseURL, apiKey: apiKey)
    }

    // MARK: - Configuration

    func configuration(for templateId: String) async throws -> TemplateConfiguration {
        if let cached = configCache[templateId] { return cached }
        let config = try await apiClient().fetchConfiguration(templateId: templateId)
        configCache[templateId] = config
        return config
    }

    // MARK: - Start

    func start(
        templateId: String,
        deepLinkParameters: [String: String],
        state: TemplatePayload
    ) async throws -> LiveStageSession {
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
        #endif

        appliedVersions[resp.sessionId] = resp.version
        staleAfterSeconds[resp.sessionId] = resp.staleAfterSeconds
        deepLinkURLs[resp.sessionId] = resp.deepLinkURL
        sessionTemplates[resp.sessionId] = templateId
        startPolling(sessionId: resp.sessionId)
        return LiveStageSession(sessionId: resp.sessionId, templateId: templateId)
    }

    // MARK: - Update (app-originated: apply immediately, do not wait for the poll)

    func update(_ session: LiveStageSession, state: TemplatePayload) async throws {
        let api = try apiClient()
        // One clientMutationId per public update call, reused across the APIClient's retries.
        let resp = try await api.update(
            sessionId: session.sessionId,
            clientMutationId: UUID().uuidString,
            payload: state
        )
        let staleSecs = staleAfterSeconds[session.sessionId] ?? 900
        let staleDate = resp.lastUpdatedAt.addingTimeInterval(TimeInterval(staleSecs))
        #if os(iOS)
        await bridge.update(sessionId: session.sessionId, state: resp.state, staleDate: staleDate)
        lastAppliedContent[session.sessionId] = resp.state
        scheduleZeroTransition(sessionId: session.sessionId)
        #endif
        appliedVersions[session.sessionId] = resp.version
    }

    // MARK: - End (idempotent server-side; stops polling and finalizes the activity)

    func end(_ session: LiveStageSession) async throws {
        let api = try apiClient()
        try await api.end(sessionId: session.sessionId, reason: nil)
        stopPolling(sessionId: session.sessionId)
        #if os(iOS)
        await bridge.end(sessionId: session.sessionId)
        #endif
        clearSession(session.sessionId)
    }

    // MARK: - Status

    func status(_ session: LiveStageSession) async throws -> SessionStatus {
        let resp = try await apiClient().get(sessionId: session.sessionId)
        return SessionStatus(
            status: try LifecycleStatus(serverStatus: resp.status),
            version: resp.version,
            lastUpdatedAt: resp.lastUpdatedAt
        )
    }

    // MARK: - Deep links

    /// Best-effort in M1: parse the URL, match it to an active session by its composed deep link, and
    /// return routing info. Recording `activity_opened` / `expanded_action_tapped` is added in M3.
    func handleDeepLink(_ url: URL) async throws -> LiveStageRoute? {
        guard let parsed = DeepLink.parse(url) else { return nil }
        let tapped = strippingSource(url)
        guard let sessionId = deepLinkURLs.first(where: { $0.value == tapped })?.key else { return nil }
        return LiveStageRoute(sessionId: sessionId, parameters: parsed.parameters, source: parsed.source)
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
        #endif
        appliedVersions[sessionId] = resp.version
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
