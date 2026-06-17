import ActivityKit
import Foundation
import LiveStageModels

/// M0 drives Live Activities **directly** through ActivityKit - there is no SDK networking yet
/// (build spec §13: "The demo app starts it locally via `Activity.request`"). The real
/// `LiveStage.start/update/end` engine arrives in M1.
@MainActor
final class LiveActivityController: ObservableObject {

    /// Session ids of the currently-live activities (drives the UI).
    @Published private(set) var liveSessionIds: [String] = []

    private var activities: [String: Activity<LiveStageActivityAttributes>] = [:]
    /// The mutable Journey state per session, so "Update" can advance it forward.
    private var journeyStates: [String: JourneyState] = [:]
    private var versions: [String: Int] = [:]

    private let primaryId = "demo-session-1"
    private let secondId = "demo-session-2"
    private let staleAfter: TimeInterval = 15 * 60   // default 900s (build spec §4.4)

    var areActivitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    // MARK: - Start

    /// Starts the primary hardcoded Journey activity (design §04 sample).
    func startPrimary() {
        let attributes = LiveStageActivityAttributes(
            sessionId: primaryId,
            templateId: "trip-status",
            templateType: .journey,
            iconIdentifier: "airplane",
            accentStyle: .blue,
            labels: TemplateLabels(nextStepLabel: "Next", targetLabel: "Departs in"),
            deepLinkURL: URL(string: "triptogether://trip?tripId=123")!
        )
        let journey = JourneyState(
            title: "Trip to Rome",
            currentStep: "Heading to the airport",
            nextStep: "Flight AZ809",
            progress: 0.35,
            targetDate: Date().addingTimeInterval(102 * 60),  // ~1h 42m, per the design sample
            statusText: "On time"
        )
        request(attributes: attributes, journey: journey)
    }

    /// Starts a SECOND activity. Two same-app activities stack on the Lock Screen, but iOS 26 does
    /// NOT reliably show the second one as a minimal in the Dynamic Island - minimal reliably appears
    /// only with Live Activities from two DIFFERENT apps (e.g. this one + a Clock timer). Kept as a
    /// Lock-Screen multi-activity demo; for minimal, verify alongside another app or via the widget preview.
    func startSecond() {
        let attributes = LiveStageActivityAttributes(
            sessionId: secondId,
            templateId: "trip-status",
            templateType: .journey,
            iconIdentifier: "car",
            accentStyle: .indigo,
            labels: TemplateLabels(nextStepLabel: "Next", targetLabel: "Departs in"),
            deepLinkURL: URL(string: "triptogether://trip?tripId=456")!
        )
        let journey = JourneyState(
            title: "Drive to Florence",
            currentStep: "Picking up the rental",
            nextStep: "Highway A1",
            progress: 0.6,
            targetDate: Date().addingTimeInterval(38 * 60),
            statusText: "Light traffic"
        )
        request(attributes: attributes, journey: journey)
    }

    private func request(attributes: LiveStageActivityAttributes, journey: JourneyState) {
        guard areActivitiesEnabled else {
            print("[TripDemo] Live Activities are not enabled on this device/simulator.")
            return
        }
        let sessionId = attributes.sessionId
        let content = ActivityContent(
            state: LiveStageContentState(
                payload: .journey(journey),
                metadata: StateMetadata(lastUpdatedAt: Date(), version: 1)
            ),
            staleDate: Date().addingTimeInterval(staleAfter)
        )
        do {
            // Foreground-only requirement (build spec §14).
            let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
            activities[sessionId] = activity
            journeyStates[sessionId] = journey
            versions[sessionId] = 1
            refreshLiveIds()
            print("[TripDemo] started \(sessionId) (Activity.id=\(activity.id))")
        } catch {
            print("[TripDemo] Activity.request failed for \(sessionId): \(error)")
        }
    }

    // MARK: - Update (local, forward-version)

    /// Advances the primary activity's Journey state - proves `Activity.update` re-renders live.
    func updatePrimary() {
        guard let activity = activities[primaryId],
              let current = journeyStates[primaryId] else { return }

        let nextProgress = min(1.0, (current.progress ?? 0) + 0.25)
        let advanced = JourneyState(
            title: current.title,
            currentStep: nextProgress >= 1.0 ? "Arrived" : "Boarding at gate B12",
            nextStep: nextProgress >= 1.0 ? nil : "Flight AZ809",
            progress: nextProgress,
            targetDate: nextProgress >= 1.0 ? nil : current.targetDate,
            statusText: nextProgress >= 1.0 ? "Arrived" : "Delayed 10 min"
        )
        let nextVersion = (versions[primaryId] ?? 1) + 1
        let content = ActivityContent(
            state: LiveStageContentState(
                payload: .journey(advanced),
                metadata: StateMetadata(lastUpdatedAt: Date(), version: nextVersion)
            ),
            staleDate: Date().addingTimeInterval(staleAfter)
        )
        journeyStates[primaryId] = advanced
        versions[primaryId] = nextVersion

        Task {
            await activity.update(content)
            print("[TripDemo] updated \(primaryId) → v\(nextVersion), progress \(nextProgress)")
        }
    }

    // MARK: - End

    func endAll() {
        let snapshot = activities
        activities.removeAll()
        journeyStates.removeAll()
        versions.removeAll()
        refreshLiveIds()
        Task {
            for (sessionId, activity) in snapshot {
                await activity.end(nil, dismissalPolicy: .immediate)
                print("[TripDemo] ended \(sessionId)")
            }
        }
    }

    private func refreshLiveIds() {
        liveSessionIds = Array(activities.keys).sorted()
    }
}
