#if os(iOS)
import ActivityKit
import Foundation
import LiveStageModels

/// The only place the SDK touches ActivityKit (build spec §5.2, `ActivityManager`). Owns the
/// `sessionId -> Activity` map and performs request/update/end, composing `ActivityContent` with the
/// supplied `staleDate`. Guarded `#if os(iOS)` so the package still builds and unit-tests on the
/// macOS host. iOS deployment is 16.2, where ActivityKit is available, so no `if #available` guards.
@available(iOS 16.2, *)
final class ActivityBridge {
    private var activities: [String: Activity<LiveStageActivityAttributes>] = [:]

    var areActivitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Requests a new Live Activity. Must be called with the app in the foreground (ActivityKit).
    /// Throws the ActivityKit error on failure so the caller can run orphan-session cleanup.
    func request(attributes: LiveStageActivityAttributes, state: LiveStageContentState, staleDate: Date) throws {
        let content = ActivityContent(state: state, staleDate: staleDate)
        let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
        activities[attributes.sessionId] = activity
    }

    func update(sessionId: String, state: LiveStageContentState, staleDate: Date) async {
        guard let activity = activities[sessionId] else { return }
        await activity.update(ActivityContent(state: state, staleDate: staleDate))
    }

    func end(sessionId: String) async {
        guard let activity = activities[sessionId] else { return }
        await activity.end(nil, dismissalPolicy: .immediate)
        activities.removeValue(forKey: sessionId)
    }

    func has(sessionId: String) -> Bool {
        activities[sessionId] != nil
    }
}
#endif
