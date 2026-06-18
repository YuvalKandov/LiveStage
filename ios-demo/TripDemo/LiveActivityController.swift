import ActivityKit
import Foundation
import LiveStage
import LiveStageModels

/// M1 drives Live Activities through the **LiveStage SDK** (`start`/`update`/`end`), not ActivityKit
/// directly (that was M0). The SDK talks to the local backend, requests the activity, and runs the
/// 8s poller so portal/backend updates flow in. ActivityKit is imported here only for the
/// `areActivitiesEnabled` capability check shown in the UI.
@MainActor
final class LiveActivityController: ObservableObject {

    /// Session ids of the currently-live activities (drives the UI).
    @Published private(set) var liveSessionIds: [String] = []
    /// The id used by the "Update" button (the first activity started).
    @Published private(set) var primarySessionId: String?
    /// Last error surfaced to the developer (e.g. backend down, validation rejected).
    @Published var lastError: String?

    private var sessions: [String: LiveStageSession] = [:]
    /// The mutable Journey state per session, so "Update" can advance it forward.
    private var journeyStates: [String: JourneyState] = [:]

    private let templateId = "trip-status"

    var areActivitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    // MARK: - Start

    /// Starts the primary Journey activity (design §04 sample) through the SDK.
    func startPrimary() {
        let journey = JourneyState(
            title: "Trip to Rome",
            currentStep: "Heading to the airport",
            nextStep: "Flight AZ809",
            progress: 0.35,
            targetDate: Date().addingTimeInterval(102 * 60),  // ~1h 42m, per the design sample
            statusText: "On time"
        )
        start(deepLinkParameters: ["tripId": "123"], journey: journey, isPrimary: true)
    }

    /// Starts a SECOND activity (different trip). Two same-app activities stack on the Lock Screen;
    /// iOS 26 does not reliably show the second as a minimal in the Dynamic Island (that needs two
    /// DIFFERENT apps, e.g. this one + a Clock timer).
    func startSecond() {
        let journey = JourneyState(
            title: "Drive to Florence",
            currentStep: "Picking up the rental",
            nextStep: "Highway A1",
            progress: 0.6,
            targetDate: Date().addingTimeInterval(38 * 60),
            statusText: "Light traffic"
        )
        start(deepLinkParameters: ["tripId": "456"], journey: journey, isPrimary: false)
    }

    private func start(deepLinkParameters: [String: String], journey: JourneyState, isPrimary: Bool) {
        Task {
            do {
                let session = try await LiveStage.start(
                    templateId: templateId,
                    deepLinkParameters: deepLinkParameters,
                    state: .journey(journey)
                )
                sessions[session.sessionId] = session
                journeyStates[session.sessionId] = journey
                if isPrimary || primarySessionId == nil { primarySessionId = session.sessionId }
                refreshLiveIds()
                print("[TripDemo] started \(session.sessionId)")
            } catch {
                report(error, context: "start")
            }
        }
    }

    // MARK: - Update (app-originated; the SDK applies it immediately)

    /// Advances the primary activity's Journey state - proves `update` re-renders live.
    func updatePrimary() {
        guard let id = primarySessionId, let session = sessions[id], let current = journeyStates[id] else { return }

        let nextProgress = min(1.0, (current.progress ?? 0) + 0.25)
        let advanced = JourneyState(
            title: current.title,
            currentStep: nextProgress >= 1.0 ? "Arrived" : "Boarding at gate B12",
            nextStep: nextProgress >= 1.0 ? nil : "Flight AZ809",
            progress: nextProgress,
            targetDate: nextProgress >= 1.0 ? nil : current.targetDate,
            statusText: nextProgress >= 1.0 ? "Arrived" : "Delayed 10 min"
        )
        Task {
            do {
                try await LiveStage.update(session, state: .journey(advanced))
                journeyStates[id] = advanced
                print("[TripDemo] updated \(id) -> progress \(nextProgress)")
            } catch {
                report(error, context: "update")
            }
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
            journeyStates.removeAll()
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
