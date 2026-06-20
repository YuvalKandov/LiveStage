import Foundation
import LiveStageModels

/// The locked §4.8 event set, verbatim. No event types beyond these in V1.
enum AnalyticsEventType: String, Sendable {
    case activityStarted = "activity_started"
    case stateApplied = "state_applied"
    case activityOpened = "activity_opened"
    case expandedActionTapped = "expanded_action_tapped"
    case activityEnded = "activity_ended"
    case syncFailed = "sync_failed"
    case dismissalObserved = "dismissal_observed"
}

/// Builds `AnalyticsEvent`s at the right moments (build spec §5.2, `EventTracker`). Pure and
/// `Sendable` so it is unit-tested directly. Every event gets a fresh `eventId` (the server dedupe
/// key) and the anonymous `installationId`. `occurredAt` is the device clock — used for timeline
/// display only, never for the latency number (that is server-clock, computed on the backend).
///
/// `metadata` is restricted to the non-personal qualifier keys (`source`, `reason`); any other key
/// is dropped so user content can never leak into the analytics stream.
struct EventTracker: Sendable {
    let installationId: String
    private static let allowedMetadataKeys: Set<String> = ["source", "reason"]

    func make(
        _ type: AnalyticsEventType,
        sessionId: String,
        templateId: String,
        version: Int? = nil,
        metadata: [String: String]? = nil
    ) -> AnalyticsEvent {
        AnalyticsEvent(
            eventId: UUID().uuidString,
            sessionId: sessionId,
            installationId: installationId,
            templateId: templateId,
            eventType: type.rawValue,
            version: version,
            occurredAt: Date(),
            metadata: Self.sanitize(metadata)
        )
    }

    /// Keeps only the allowlisted keys; returns nil if nothing survives (so the field stays absent).
    private static func sanitize(_ metadata: [String: String]?) -> [String: String]? {
        guard let metadata else { return nil }
        let filtered = metadata.filter { allowedMetadataKeys.contains($0.key) }
        return filtered.isEmpty ? nil : filtered
    }
}
