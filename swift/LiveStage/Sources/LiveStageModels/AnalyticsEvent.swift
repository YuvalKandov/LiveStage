import Foundation

/// A single analytics event the SDK reports to the backend (build spec §4.8, locked). Events carry
/// **identifiers and types only — never user-facing content**: `sessionId`, `installationId`,
/// `templateId`, `eventType`, `version`, timestamps, and a small non-personal `metadata` map
/// (only `source` / `reason`). The activity's actual state stays in `session_states`, out of the
/// analytics stream.
///
/// `eventId` is a client UUID and the server's dedupe key, so a retried batch upload never
/// double-counts. `installationId` is an anonymous per-install id, never a user identity.
public struct AnalyticsEvent: Codable, Hashable, Sendable {
    public let eventId: String
    public let sessionId: String
    public let installationId: String
    public let templateId: String
    public let eventType: String
    public let version: Int?       // for state_applied: which state version was applied
    public let occurredAt: Date    // device clock — for the timeline display only, never the latency number
    public let metadata: [String: String]?

    public init(
        eventId: String,
        sessionId: String,
        installationId: String,
        templateId: String,
        eventType: String,
        version: Int? = nil,
        occurredAt: Date,
        metadata: [String: String]? = nil
    ) {
        self.eventId = eventId
        self.sessionId = sessionId
        self.installationId = installationId
        self.templateId = templateId
        self.eventType = eventType
        self.version = version
        self.occurredAt = occurredAt
        self.metadata = metadata
    }
}
