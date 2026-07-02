import ActivityKit
import Foundation
import LiveStage
import LiveStageModels
import UIKit

/// One of the Trips-tab cards. Each card maps to one template and at most one live session, so the
/// card can mirror the state its Live Activity is currently showing.
enum DemoCard: String, CaseIterable, Identifiable {
    case trip       // Journey template ("trip-status")
    case flight     // Countdown template ("flight-countdown")
    case delivery   // Progress template ("order-progress")
    var id: String { rawValue }
}

/// Drives Live Activities through the **LiveStage SDK** (`start`/`update`/`end`), not ActivityKit
/// directly. The SDK talks to the local backend, requests the activity, runs the 8s poller, and (for
/// Countdown) schedules the single zero-transition re-render. Serves two surfaces: the Trips tab
/// (per-card track/advance/stop plus the scripted demo sequence) and the Developer tab (the raw
/// start/update/end test harness). Both share the same session bookkeeping.
@MainActor
final class LiveActivityController: ObservableObject {

    @Published private(set) var liveSessionIds: [String] = []
    /// The session the "Update" button advances - always the most recently started activity.
    @Published private(set) var primarySessionId: String?
    @Published var lastError: String?
    /// Card -> live session, so the Trips tab can mirror each card's activity.
    @Published private(set) var cardSessionIds: [DemoCard: String] = [:]
    /// The last state the app applied per session (start, update, or demo step), shown on the cards.
    @Published private(set) var lastPayloads: [String: TemplatePayload] = [:]
    @Published private(set) var isPlayingDemo = false

    private var sessions: [String: LiveStageSession] = [:]
    private var demoTask: Task<Void, Never>?
    private var demoKeepAlive: UIBackgroundTaskIdentifier = .invalid

    var areActivitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Whether a card can start: the key is configured and the device allows Live Activities.
    var isReady: Bool {
        DemoConfig.isConfigured && areActivitiesEnabled
    }

    // MARK: - Trips tab (cards)

    func isLive(_ card: DemoCard) -> Bool {
        cardSessionIds[card] != nil
    }

    func payload(for card: DemoCard) -> TemplatePayload? {
        cardSessionIds[card].flatMap { lastPayloads[$0] }
    }

    /// Starts the card's activity (no-op if it is already live).
    func track(_ card: DemoCard) {
        guard cardSessionIds[card] == nil else { return }
        Task {
            do {
                _ = try await startSession(for: card)
            } catch {
                report(error, context: "start")
            }
        }
    }

    /// Advances the card's activity one step forward (same forward states as the Developer tab).
    func advance(_ card: DemoCard) {
        guard let id = cardSessionIds[card] else { return }
        update(sessionId: id)
    }

    /// Ends just this card's activity. On failure the handle is kept so Stop can be retried.
    func stop(_ card: DemoCard) {
        guard let id = cardSessionIds[card], let session = sessions[id] else {
            cardSessionIds[card] = nil
            return
        }
        if card == .trip { stopDemo() }
        Task {
            do {
                try await LiveStage.end(session)
                forget(sessionId: id)
                print("[TripDemo] ended \(id)")
            } catch {
                report(error, context: "end")
            }
        }
    }

    /// Plays the scripted trip sequence: starts the trip activity if needed, then applies the next
    /// states one by one, so the Live Activity animates through its whole life hands-free. Never
    /// calls `end` - the activity stays up (Stop is explicit), and Stop cancels the sequence.
    ///
    /// The sequence runs in the app process, and iOS suspends a backgrounded app after ~30s - which
    /// is exactly when the presenter has locked the phone to watch the Lock Screen. The background
    /// task asks iOS to keep the process alive for the sequence, and the 6s pacing keeps the whole
    /// story (24s) inside the window so the final "Arrived" state renders without reopening the app.
    func playDemo() {
        guard !isPlayingDemo else { return }
        demoTask = Task {
            isPlayingDemo = true
            beginDemoKeepAlive()
            do {
                let script = Self.demoScript()
                let sessionId: String
                if let existing = cardSessionIds[.trip] {
                    sessionId = existing
                } else {
                    sessionId = try await startSession(for: .trip)
                }
                for step in script.dropFirst() {
                    try await Task.sleep(nanoseconds: 6_000_000_000)
                    guard let session = sessions[sessionId] else { break }   // ended meanwhile
                    try await LiveStage.update(session, state: .journey(step))
                    lastPayloads[sessionId] = .journey(step)
                    print("[TripDemo] demo step: \(step.currentStep)")
                }
            } catch is CancellationError {
                // Stopped mid-sequence; the activity keeps its last applied state.
            } catch {
                report(error, context: "demo")
            }
            endDemoKeepAlive()
            isPlayingDemo = false
        }
    }

    func stopDemo() {
        demoTask?.cancel()
        demoTask = nil
        endDemoKeepAlive()
        isPlayingDemo = false
    }

    private func beginDemoKeepAlive() {
        endDemoKeepAlive()
        demoKeepAlive = UIApplication.shared.beginBackgroundTask(withName: "LiveStageDemoSequence") { [weak self] in
            // iOS is reclaiming the time; release the task or the app gets killed.
            Task { @MainActor in self?.endDemoKeepAlive() }
        }
    }

    private func endDemoKeepAlive() {
        guard demoKeepAlive != .invalid else { return }
        UIApplication.shared.endBackgroundTask(demoKeepAlive)
        demoKeepAlive = .invalid
    }

    /// The trip states the demo sequence walks through (dates are relative to play time). Step 0 is
    /// also the state "Track this trip" starts with.
    private static func demoScript(now: Date = Date()) -> [JourneyState] {
        [
            JourneyState(
                title: "Trip to Rome",
                currentStep: "Heading to the airport",
                nextStep: "Security check",
                progress: 0.15,
                targetDate: now.addingTimeInterval(102 * 60),
                statusText: "On time"
            ),
            JourneyState(
                title: "Trip to Rome",
                currentStep: "Security check",
                nextStep: "Boarding at gate B12",
                progress: 0.35,
                targetDate: now.addingTimeInterval(90 * 60),
                statusText: "On time"
            ),
            JourneyState(
                title: "Trip to Rome",
                currentStep: "Boarding at gate B12",
                nextStep: "Flight AZ809",
                progress: 0.6,
                targetDate: now.addingTimeInterval(75 * 60),
                statusText: "Boarding"
            ),
            JourneyState(
                title: "Trip to Rome",
                currentStep: "In flight to Rome",
                nextStep: "Landing at FCO",
                progress: 0.85,
                targetDate: now.addingTimeInterval(45 * 60),
                statusText: "Departed"
            ),
            JourneyState(
                title: "Trip to Rome",
                currentStep: "Arrived in Rome",
                nextStep: nil,
                progress: 1.0,
                targetDate: nil,
                statusText: "Arrived"
            ),
        ]
    }

    /// The initial payload + identifiers for each card.
    private func startSession(for card: DemoCard) async throws -> String {
        switch card {
        case .trip:
            return try await startSession(
                templateId: "trip-status",
                deepLinkParameters: ["tripId": "rome-2026"],
                payload: .journey(Self.demoScript()[0]),
                card: card
            )
        case .flight:
            let countdown = CountdownState(
                title: "Flight to Rome",
                subtitle: "Gate B12",
                targetDate: Date().addingTimeInterval(5 * 60),
                statusText: "Boarding soon",
                location: "Terminal 3"
            )
            return try await startSession(
                templateId: "flight-countdown",
                deepLinkParameters: ["flightId": "AZ809"],
                payload: .countdown(countdown),
                card: card
            )
        case .delivery:
            let progress = ProgressState(
                title: "Preparing your order",
                currentStage: "Packing",
                progress: 0.4,
                estimatedCompletionDate: Date().addingTimeInterval(25 * 60),
                detailText: "3 items left"
            )
            return try await startSession(
                templateId: "order-progress",
                deepLinkParameters: ["orderId": "42"],
                payload: .progress(progress),
                card: card
            )
        }
    }

    // MARK: - Developer tab (the raw test harness; the design-doc sample states)

    func startJourney() {
        startInBackground(
            templateId: "trip-status",
            deepLinkParameters: ["tripId": "123"],
            payload: .journey(JourneyState(
                title: "Trip to Rome",
                currentStep: "Heading to the airport",
                nextStep: "Flight AZ809",
                progress: 0.35,
                targetDate: Date().addingTimeInterval(102 * 60),  // ~1h 42m, per the design sample
                statusText: "On time"
            ))
        )
    }

    /// A SECOND activity (different trip). Two same-app activities stack on the Lock Screen; the
    /// minimal Dynamic Island presentation appears when 2+ activities are live.
    func startSecondJourney() {
        startInBackground(
            templateId: "trip-status",
            deepLinkParameters: ["tripId": "456"],
            payload: .journey(JourneyState(
                title: "Drive to Florence",
                currentStep: "Picking up the rental",
                nextStep: "Highway A1",
                progress: 0.6,
                targetDate: Date().addingTimeInterval(38 * 60),
                statusText: "Light traffic"
            ))
        )
    }

    /// Countdown with a target ~25s out, so the zero-flip to `zeroStateLabel` ("Boarding now") is
    /// observable quickly. The SDK fires one local re-render at the target (no per-second pushes).
    func startCountdown() {
        startInBackground(
            templateId: "flight-countdown",
            deepLinkParameters: ["flightId": "AZ809"],
            payload: .countdown(CountdownState(
                title: "Flight to Rome",
                subtitle: "Gate B12",
                targetDate: Date().addingTimeInterval(25),
                statusText: "Boarding soon",
                location: "Terminal 3"
            ))
        )
    }

    func startProgress() {
        startInBackground(
            templateId: "order-progress",
            deepLinkParameters: ["orderId": "42"],
            payload: .progress(ProgressState(
                title: "Preparing your order",
                currentStage: "Packing",
                progress: 0.72,
                estimatedCompletionDate: Date().addingTimeInterval(18 * 60),
                detailText: "3 items left"
            ))
        )
    }

    /// Debug: the short-stale template (staleAfterSeconds=20). Start it and wait ~20s without an
    /// update to see the stale de-emphasis + hint; then tap Update to restore the normal look.
    func startStaleDemo() {
        startInBackground(
            templateId: "stale-demo",
            deepLinkParameters: ["tripId": "stale"],
            payload: .journey(JourneyState(
                title: "Stale demo",
                currentStep: "Waiting for an update",
                progress: 0.4,
                statusText: "Fresh"
            ))
        )
    }

    func updatePrimary() {
        guard let id = primarySessionId else { return }
        update(sessionId: id)
    }

    func endAll() {
        stopDemo()
        let snapshot = Array(sessions.values)
        Task {
            // Drop only the handles whose end actually succeeded. If the backend is down, the
            // activities are still on the Lock Screen and these handles are the only way to retry -
            // discarding them would strand the activities until the system timeout.
            for session in snapshot {
                do {
                    try await LiveStage.end(session)
                    forget(sessionId: session.sessionId)
                    print("[TripDemo] ended \(session.sessionId)")
                } catch {
                    report(error, context: "end")
                }
            }
        }
    }

    // MARK: - Shared session bookkeeping

    /// The one real SDK `start` call every path funnels through.
    private func startSession(
        templateId: String,
        deepLinkParameters: [String: String],
        payload: TemplatePayload,
        card: DemoCard? = nil
    ) async throws -> String {
        let session = try await LiveStage.start(
            templateId: templateId,
            deepLinkParameters: deepLinkParameters,
            state: payload
        )
        sessions[session.sessionId] = session
        lastPayloads[session.sessionId] = payload
        primarySessionId = session.sessionId   // the latest started is what "Update" advances
        if let card { cardSessionIds[card] = session.sessionId }
        refreshLiveIds()
        print("[TripDemo] started \(templateId) \(session.sessionId)")
        return session.sessionId
    }

    /// Fire-and-forget wrapper for the Developer tab buttons.
    private func startInBackground(templateId: String, deepLinkParameters: [String: String], payload: TemplatePayload) {
        Task {
            do {
                _ = try await startSession(templateId: templateId, deepLinkParameters: deepLinkParameters, payload: payload)
            } catch {
                report(error, context: "start")
            }
        }
    }

    /// Advances one session's state forward by its template type.
    private func update(sessionId: String) {
        guard let session = sessions[sessionId], let current = lastPayloads[sessionId] else { return }
        let next = Self.advance(current)
        Task {
            do {
                try await LiveStage.update(session, state: next)
                lastPayloads[sessionId] = next
                print("[TripDemo] updated \(sessionId)")
            } catch {
                report(error, context: "update")
            }
        }
    }

    /// Produces the next forward state for a payload, per its type (proves `update` re-renders live).
    private static func advance(_ payload: TemplatePayload) -> TemplatePayload {
        switch payload {
        case .journey(let s):
            let p = min(1.0, (s.progress ?? 0) + 0.25)
            return .journey(JourneyState(
                title: s.title,
                currentStep: p >= 1 ? "Arrived" : "Boarding at gate B12",
                nextStep: p >= 1 ? nil : "Flight AZ809",
                progress: p,
                targetDate: p >= 1 ? nil : s.targetDate,
                statusText: p >= 1 ? "Arrived" : "Delayed 10 min"
            ))
        case .countdown(let s):
            // Bring the target close (final call) - also proves a completed countdown stays updateable.
            return .countdown(CountdownState(
                title: s.title,
                subtitle: s.subtitle,
                targetDate: Date().addingTimeInterval(10),
                statusText: "Final call",
                location: s.location
            ))
        case .progress(let s):
            let p = min(1.0, s.progress + 0.25)
            let remaining = Int((1 - p) * 10)
            return .progress(ProgressState(
                title: s.title,
                currentStage: p >= 1 ? "Done" : "Packing",
                progress: p,
                estimatedCompletionDate: s.estimatedCompletionDate,
                detailText: p >= 1 ? nil : "\(remaining) items left"
            ))
        }
    }

    /// Removes an ended session from every piece of bookkeeping (sessions, payloads, card map,
    /// primary pointer, live list).
    private func forget(sessionId: String) {
        sessions.removeValue(forKey: sessionId)
        lastPayloads.removeValue(forKey: sessionId)
        for (card, id) in cardSessionIds where id == sessionId {
            cardSessionIds[card] = nil
        }
        if primarySessionId == sessionId {
            primarySessionId = sessions.keys.sorted().last
        }
        refreshLiveIds()
    }

    // MARK: - Helpers

    private func refreshLiveIds() {
        liveSessionIds = sessions.keys.sorted()
    }

    private func report(_ error: Error, context: String) {
        let message = "\(context): \(error)"
        lastError = message
        print("[TripDemo] \(message)")
    }
}
