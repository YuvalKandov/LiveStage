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

    /// Set by the runtime to record a best-effort `dismissal_observed` when ActivityKit reports a
    /// local dismissal while the app is running (build spec §4.8/§8.5).
    var onDismissed: (@Sendable (String) -> Void)?

    var areActivitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Requests a new Live Activity. Must be called with the app in the foreground (ActivityKit).
    /// Throws the ActivityKit error on failure so the caller can run orphan-session cleanup.
    func request(attributes: LiveStageActivityAttributes, state: LiveStageContentState, staleDate: Date) throws {
        let content = ActivityContent(state: state, staleDate: staleDate)
        let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
        activities[attributes.sessionId] = activity
        observeDismissal(of: activity, sessionId: attributes.sessionId)
    }

    /// Watches the activity's state stream; on a local dismissal while the app runs, fires the
    /// best-effort callback once. The system ends this stream when the activity finishes.
    private func observeDismissal(of activity: Activity<LiveStageActivityAttributes>, sessionId: String) {
        let callback = onDismissed
        guard let callback else { return }
        Task {
            for await state in activity.activityStateUpdates {
                if state == .dismissed {
                    callback(sessionId)
                    break
                }
            }
        }
    }

    /// Applies new content to the session's activity. Returns whether anything was actually applied:
    /// with no live activity for the session (dismissed, or a relaunched process that never requested
    /// one) this is a no-op and the caller must NOT record a `state_applied` ack for it.
    @discardableResult
    func update(sessionId: String, state: LiveStageContentState, staleDate: Date) async -> Bool {
        guard let activity = activities[sessionId] else { return false }
        await activity.update(ActivityContent(state: state, staleDate: staleDate))
        return true
    }

    func end(sessionId: String) async {
        guard let activity = activities[sessionId] else { return }
        await activity.end(nil, dismissalPolicy: .immediate)
        activities.removeValue(forKey: sessionId)
    }

    /// Drops the handle for an activity the system already removed (a local dismissal). No `end`
    /// call is made - there is nothing left on the device to end.
    func remove(sessionId: String) {
        activities.removeValue(forKey: sessionId)
    }

    func has(sessionId: String) -> Bool {
        activities[sessionId] != nil
    }
}
#endif
