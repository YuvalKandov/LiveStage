import Foundation

/// A handle to a started activity. Returned by `start`, passed back to `update`/`end`/`status`.
public struct LiveStageSession: Codable, Hashable, Sendable {
    public let sessionId: String
    public let templateId: String

    public init(sessionId: String, templateId: String) {
        self.sessionId = sessionId
        self.templateId = templateId
    }
}

/// Which interaction a deep link represents. The primary tap opens the main activity; an
/// `expandedAction` is a tap on a specific `Link` inside the expanded Dynamic Island
/// (it carries `source=expanded_action`). Distinct intentional actions, never a long-press count.
public enum InteractionSource: String, Codable, Hashable, Sendable {
    case primary
    case expandedAction
}

/// The routing info `handleDeepLink` returns to the host app after a LiveStage deep link is tapped.
public struct LiveStageRoute: Codable, Hashable, Sendable {
    public let sessionId: String
    public let parameters: [String: String]   // e.g. ["tripId": "123"], with `source` stripped
    public let source: InteractionSource

    public init(sessionId: String, parameters: [String: String], source: InteractionSource) {
        self.sessionId = sessionId
        self.parameters = parameters
        self.source = source
    }
}

/// Lifecycle status. **The server returns only `active` or `ended`** (build spec §8.5). `stale` and
/// `dismissed` are *local* ActivityKit realities the SDK may observe on-device; they are never sent
/// by the server, so a status fetched from the server is always `active` or `ended`.
public enum LifecycleStatus: String, Codable, Hashable, Sendable {
    case active
    case ended
    /// Local-only: ActivityKit marked the activity stale (no timely newer version). Never server-sent.
    case stale
    /// Local-only: a dismissal observed on-device while the app runs. Never server-sent.
    case dismissed

    /// Decodes a *server* status, which is strictly `active | ended`. Any other value is rejected
    /// so the local-only cases can never be fabricated from a server response.
    init(serverStatus raw: String) throws {
        switch raw {
        case "active": self = .active
        case "ended": self = .ended
        default:
            throw LiveStageError.decoding(
                DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Unexpected server status \(raw)"))
            )
        }
    }
}

/// The result of `status` (build spec §5.1).
public struct SessionStatus: Codable, Hashable, Sendable {
    public let status: LifecycleStatus
    public let version: Int
    public let lastUpdatedAt: Date

    public init(status: LifecycleStatus, version: Int, lastUpdatedAt: Date) {
        self.status = status
        self.version = version
        self.lastUpdatedAt = lastUpdatedAt
    }
}
