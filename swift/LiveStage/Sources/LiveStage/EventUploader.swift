import Foundation
import LiveStageModels

/// Per-event result the backend returns for a batch (build spec §8.3 events route). `accepted` and
/// `duplicates` are counts; `discarded` lists events the server permanently refused (e.g. an unknown
/// session) with a generic reason. A discarded event was **not** stored and is **not** counted as
/// accepted — but the client should drop it from the queue rather than retry it forever.
struct DiscardedEvent: Decodable, Sendable {
    let eventId: String
    let reason: String
}

struct BatchUploadResponse: Decodable, Sendable {
    let accepted: Int
    let duplicates: Int
    let discarded: [DiscardedEvent]
}

/// The ids the server has finished with for one batch: accepted + duplicate + permanently discarded.
/// The pipeline removes exactly these from the queue and retains everything else.
struct BatchOutcome: Sendable {
    let completedIds: Set<String>
}

/// Uploads a batch and reports which ids are completed. Abstracted so the pipeline's flush/removal
/// logic can be unit-tested without the network.
protocol EventUploading: Sendable {
    func upload(_ events: [AnalyticsEvent]) async throws -> BatchOutcome
}

/// Flushes batches of events to `POST /v1/events/batch` (build spec §5.2, `EventUploader`). Thin by
/// design: the `APIClient` already adds the key and retries transport/5xx with backoff, and the
/// server's `eventId` dedupe makes a resend safe.
struct EventUploader: EventUploading {
    let api: APIClient

    func upload(_ events: [AnalyticsEvent]) async throws -> BatchOutcome {
        let response = try await api.uploadEvents(events)
        return BatchOutcome(completedIds: Self.completedIds(sent: events, response: response))
    }

    /// Maps a batch response to the set of completed ids (CP7 requirements 3 & 4). The server returns
    /// an outcome for every event it processes, so on a normal 2xx the whole batch is completed
    /// (accepted, duplicate, or permanently discarded). If it ever accounted for fewer than were sent
    /// (a partial result), only the explicitly-named discarded ids are safe to drop; the rest are
    /// retained for retry.
    static func completedIds(sent: [AnalyticsEvent], response: BatchUploadResponse) -> Set<String> {
        let discardedIds = Set(response.discarded.map(\.eventId))
        let accountedFor = response.accepted + response.duplicates + response.discarded.count
        return accountedFor >= sent.count ? Set(sent.map(\.eventId)) : discardedIds
    }
}
