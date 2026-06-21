import Foundation
import LiveStageModels

/// Owns the durable event queue, the tracker, and the uploader, and serializes all of them on one
/// actor (build spec §5.2). `LiveStageRuntime` holds one and calls `record(...)` at the emission
/// points; recording persists the event and schedules a **coalesced** flush so a burst uploads as one
/// batch rather than one request each.
///
/// The `APIClient` is built lazily from the shared `ConfigStore` because `configure(apiKey:baseURL:)`
/// runs after the SDK's singletons are created; a flush with no configuration (and no injected
/// uploader) is a no-op, leaving events queued on disk. On a flush, only the ids the server reports
/// as completed (accepted, duplicate, or permanently discarded) are removed; a network/server failure
/// keeps the whole batch on disk for retry, which the `eventId` dedupe makes safe.
actor EventPipeline {
    private let config: ConfigStore
    private let tracker: EventTracker
    private let injectedUploader: EventUploading?
    private let batchSize: Int

    private var queue: EventQueue
    private var flushTask: Task<Void, Never>?
    private var isFlushing = false

    init(
        config: ConfigStore,
        installationId: String = InstallationID.current(),
        store: EventStore = FileEventStore(),
        uploader: EventUploading? = nil,
        batchSize: Int = 50
    ) {
        self.config = config
        self.tracker = EventTracker(installationId: installationId)
        self.injectedUploader = uploader
        self.batchSize = batchSize
        self.queue = EventQueue(store: store)
    }

    /// Builds, persists, and schedules a flush for one event. Persistence failures are logged, never
    /// thrown to the caller: analytics is best-effort and must not break a `start`/`update`/`end`.
    func record(
        _ type: AnalyticsEventType,
        sessionId: String,
        templateId: String,
        version: Int? = nil,
        metadata: [String: String]? = nil
    ) {
        let event = tracker.make(type, sessionId: sessionId, templateId: templateId, version: version, metadata: metadata)
        do {
            try queue.enqueue(event)
        } catch {
            // Do not pretend the event was durably queued — surface it to the debug log (CP7 req 2).
            LiveStageLog.debug("failed to persist analytics event \(event.eventId): \(error)")
        }
        scheduleFlush()
    }

    /// Coalesces concurrent record calls into a single in-flight flush.
    private func scheduleFlush() {
        guard flushTask == nil else { return }
        flushTask = Task { [weak self] in
            await self?.flush()
            await self?.clearFlushTask()
        }
    }

    private func clearFlushTask() {
        flushTask = nil
    }

    /// Uploads queued events in batches. Removes only the ids the server completed; stops on a network
    /// failure or a partial result (retained events retry on the next flush). Called by `scheduleFlush`
    /// (record bursts), by tests, and by the runtime's foreground hook (upload-on-reconnect), so it is
    /// **single-flight**: a concurrent invocation while one is in progress returns immediately rather
    /// than racing the same queue file. The in-progress pass picks up anything appended meanwhile (its
    /// `while` loop re-checks the queue), and the `eventId` dedupe makes any later retry safe.
    func flush() async {
        guard !isFlushing else { return }
        isFlushing = true
        defer { isFlushing = false }
        guard let uploader = currentUploader() else { return }   // not configured yet — keep queued
        while !queue.isEmpty {
            let batch = queue.peekBatch(max: batchSize)
            guard let outcome = try? await uploader.upload(batch) else { break }   // failure — keep all
            queue.remove(ids: outcome.completedIds)
            // If the batch was not fully completed, stop: the retained events retry on the next flush
            // (dedupe-safe) instead of being re-sent within this pass.
            if !batch.allSatisfy({ outcome.completedIds.contains($0.eventId) }) { break }
        }
    }

    private func currentUploader() -> EventUploading? {
        if let injectedUploader { return injectedUploader }
        guard let creds = try? config.current() else { return nil }
        return EventUploader(api: APIClient(baseURL: creds.baseURL, apiKey: creds.apiKey))
    }

    // MARK: - Test accessors (internal)

    func queuedCount() -> Int { queue.count }
    func queuedIds() -> [String] { queue.ids }
}
