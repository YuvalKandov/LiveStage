import Foundation
import LiveStageModels

/// The entire developer-facing surface of the LiveStage SDK (build spec §5.1). Seven entry points,
/// no more. Everything routes through a single shared `LiveStageRuntime` actor.
///
/// Usage:
/// ```swift
/// LiveStage.configure(apiKey: key, baseURL: URL(string: "http://localhost:8787")!)
/// let session = try await LiveStage.start(templateId: "trip-status",
///                                         deepLinkParameters: ["tripId": "123"],
///                                         state: .journey(...))
/// try await LiveStage.update(session, state: .journey(...))
/// try await LiveStage.end(session)
/// ```
public enum LiveStage {
    private static let config = ConfigStore()
    private static let runtime = LiveStageRuntime(config: config)

    /// Must be called once (e.g. at app launch) before any other API.
    public static func configure(apiKey: String, baseURL: URL) {
        config.set(apiKey: apiKey, baseURL: baseURL)
    }

    /// Starts a Live Activity: validates server-side, creates the session, requests the activity, and
    /// begins polling. Must be called with the app in the foreground (ActivityKit requirement). If the
    /// local `Activity.request` fails, the just-created server session is ended before the error is
    /// rethrown (orphan-session compensation).
    @discardableResult
    public static func start(
        templateId: String,
        deepLinkParameters: [String: String] = [:],
        state: TemplatePayload
    ) async throws -> LiveStageSession {
        try await runtime.start(templateId: templateId, deepLinkParameters: deepLinkParameters, state: state)
    }

    /// Applies an app-originated update: the backend accepts it, then the SDK renders it immediately
    /// (it does not wait for the next poll).
    public static func update(_ session: LiveStageSession, state: TemplatePayload) async throws {
        try await runtime.update(session, state: state)
    }

    /// Ends the activity (idempotent server-side) and stops its polling.
    public static func end(_ session: LiveStageSession) async throws {
        try await runtime.end(session)
    }

    /// Fetches a template configuration (cached after the first call).
    public static func fetchConfiguration(templateId: String) async throws -> TemplateConfiguration {
        try await runtime.configuration(for: templateId)
    }

    /// Fetches the current server status (`active`/`ended`), version, and last-updated time.
    public static func status(_ session: LiveStageSession) async throws -> SessionStatus {
        try await runtime.status(session)
    }

    /// Call from the host app's `.onOpenURL`. Returns routing info for a LiveStage deep link (and, in
    /// M3, records `activity_opened` vs `expanded_action_tapped` from the URL's `source`). Returns nil
    /// for URLs that don't belong to a known LiveStage activity.
    @discardableResult
    public static func handleDeepLink(_ url: URL) async throws -> LiveStageRoute? {
        try await runtime.handleDeepLink(url)
    }
}
