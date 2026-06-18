import ActivityKit
import Foundation
import LiveStage
import LiveStageModels

/// Drives Live Activities through the **LiveStage SDK** (`start`/`update`/`end`), not ActivityKit
/// directly. The SDK talks to the local backend, requests the activity, runs the 8s poller, and (for
/// Countdown) schedules the single zero-transition re-render. M2 drives all three templates; the
/// controller tracks the last applied payload per session so "Update" can advance it forward by type.
@MainActor
final class LiveActivityController: ObservableObject {

    @Published private(set) var liveSessionIds: [String] = []
    /// The session the "Update" button advances - always the most recently started activity.
    @Published private(set) var primarySessionId: String?
    @Published var lastError: String?

    private var sessions: [String: LiveStageSession] = [:]
    private var lastPayloads: [String: TemplatePayload] = [:]

    var areActivitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    // MARK: - Start (one per template; the design-doc sample states)

    func startJourney() {
        let journey = JourneyState(
            title: "Trip to Rome",
            currentStep: "Heading to the airport",
            nextStep: "Flight AZ809",
            progress: 0.35,
            targetDate: Date().addingTimeInterval(102 * 60),  // ~1h 42m, per the design sample
            statusText: "On time"
        )
        start(templateId: "trip-status", deepLinkParameters: ["tripId": "123"], payload: .journey(journey))
    }

    /// A SECOND activity (different trip). Two same-app activities stack on the Lock Screen; the
    /// minimal Dynamic Island presentation appears when 2+ activities are live.
    func startSecondJourney() {
        let journey = JourneyState(
            title: "Drive to Florence",
            currentStep: "Picking up the rental",
            nextStep: "Highway A1",
            progress: 0.6,
            targetDate: Date().addingTimeInterval(38 * 60),
            statusText: "Light traffic"
        )
        start(templateId: "trip-status", deepLinkParameters: ["tripId": "456"], payload: .journey(journey))
    }

    /// Countdown with a target ~25s out, so the zero-flip to `zeroStateLabel` ("Boarding now") is
    /// observable quickly. The SDK fires one local re-render at the target (no per-second pushes).
    func startCountdown() {
        let countdown = CountdownState(
            title: "Flight to Rome",
            subtitle: "Gate B12",
            targetDate: Date().addingTimeInterval(25),
            statusText: "Boarding soon",
            location: "Terminal 3"
        )
        start(templateId: "flight-countdown", deepLinkParameters: ["flightId": "AZ809"], payload: .countdown(countdown))
    }

    func startProgress() {
        let progress = ProgressState(
            title: "Preparing your order",
            currentStage: "Packing",
            progress: 0.72,
            estimatedCompletionDate: Date().addingTimeInterval(18 * 60),
            detailText: "3 items left"
        )
        start(templateId: "order-progress", deepLinkParameters: ["orderId": "42"], payload: .progress(progress))
    }

    /// Debug: the short-stale template (staleAfterSeconds=20). Start it and wait ~20s without an
    /// update to see the stale de-emphasis + hint; then tap Update to restore the normal look.
    func startStaleDemo() {
        let journey = JourneyState(
            title: "Stale demo",
            currentStep: "Waiting for an update",
            progress: 0.4,
            statusText: "Fresh"
        )
        start(templateId: "stale-demo", deepLinkParameters: ["tripId": "stale"], payload: .journey(journey))
    }

    private func start(templateId: String, deepLinkParameters: [String: String], payload: TemplatePayload) {
        Task {
            do {
                let session = try await LiveStage.start(
                    templateId: templateId,
                    deepLinkParameters: deepLinkParameters,
                    state: payload
                )
                sessions[session.sessionId] = session
                lastPayloads[session.sessionId] = payload
                primarySessionId = session.sessionId   // the latest started is what "Update" advances
                refreshLiveIds()
                print("[TripDemo] started \(templateId) \(session.sessionId)")
            } catch {
                report(error, context: "start")
            }
        }
    }

    // MARK: - Update (advance the primary session's state forward, by template type)

    func updatePrimary() {
        guard let id = primarySessionId, let session = sessions[id], let current = lastPayloads[id] else { return }
        let next = Self.advance(current)
        Task {
            do {
                try await LiveStage.update(session, state: next)
                lastPayloads[id] = next
                print("[TripDemo] updated \(id)")
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

    // MARK: - End

    func endAll() {
        let snapshot = Array(sessions.values)
        Task {
            for session in snapshot {
                do {
                    try await LiveStage.end(session)
                    print("[TripDemo] ended \(session.sessionId)")
                } catch {
                    report(error, context: "end")
                }
            }
            sessions.removeAll()
            lastPayloads.removeAll()
            primarySessionId = nil
            refreshLiveIds()
        }
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
