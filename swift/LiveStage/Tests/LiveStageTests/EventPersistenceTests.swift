import XCTest
@testable import LiveStage
import LiveStageModels

// MARK: - Test doubles (shared across the SDK test target)

/// In-memory EventStore that just holds the last-saved array.
final class InMemoryEventStore: EventStore, @unchecked Sendable {
    private(set) var saved: [AnalyticsEvent] = []
    init(_ initial: [AnalyticsEvent] = []) { saved = initial }
    func load() throws -> [AnalyticsEvent] { saved }
    func save(_ events: [AnalyticsEvent]) throws { saved = events }
}

/// EventStore whose `save` always fails, to prove a persistence failure is surfaced.
final class FailingEventStore: EventStore, @unchecked Sendable {
    func load() throws -> [AnalyticsEvent] { [] }
    func save(_ events: [AnalyticsEvent]) throws {
        throw LiveStageError.network(underlying: URLError(.cannotCreateFile))
    }
}

/// Controllable uploader: completes everything, completes a fixed id set, or fails. An optional hook
/// runs (once) during the first upload, to exercise appending while a flush is in progress.
final class StubUploader: EventUploading, @unchecked Sendable {
    enum Mode { case completeAll, complete(Set<String>), fail }
    private let lock = NSLock()
    private var _received: [[AnalyticsEvent]] = []
    private var _mode: Mode = .completeAll
    private var _hook: (@Sendable () async -> Void)?

    var received: [[AnalyticsEvent]] { lock.lock(); defer { lock.unlock() }; return _received }
    func setMode(_ mode: Mode) { lock.lock(); _mode = mode; lock.unlock() }
    func setHook(_ hook: @escaping @Sendable () async -> Void) { lock.lock(); _hook = hook; lock.unlock() }

    func upload(_ events: [AnalyticsEvent]) async throws -> BatchOutcome {
        lock.lock()
        _received.append(events)
        let hook = _hook; _hook = nil // run once
        let mode = _mode
        lock.unlock()

        if let hook { await hook() }
        switch mode {
        case .completeAll:
            return BatchOutcome(completedIds: Set(events.map(\.eventId)))
        case .complete(let ids):
            return BatchOutcome(completedIds: ids.intersection(Set(events.map(\.eventId))))
        case .fail:
            throw LiveStageError.network(underlying: URLError(.notConnectedToInternet))
        }
    }
}

/// Durable event persistence (build spec §5.2/§5.4, CP7). All host-side; no simulator or network.
final class EventPersistenceTests: XCTestCase {

    private let tracker = EventTracker(installationId: "install-test")
    private func makeEvent(_ type: AnalyticsEventType = .activityStarted, session: String = "s") -> AnalyticsEvent {
        tracker.make(type, sessionId: session, templateId: "t")
    }
    private func tempDir() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("LiveStageTests-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
    /// A ConfigStore is required by the pipeline init but unused when an uploader is injected.
    private func unconfigured() -> ConfigStore { ConfigStore() }

    // MARK: - Durability

    func testEventsSurviveRelaunchViaFileStore() throws {
        let dir = tempDir()
        var q1 = EventQueue(store: FileEventStore(directory: dir))
        let e1 = makeEvent(.activityStarted), e2 = makeEvent(.stateApplied), e3 = makeEvent(.activityEnded)
        try q1.enqueue(e1); try q1.enqueue(e2); try q1.enqueue(e3)

        // Simulated relaunch: a brand-new store + queue over the same directory.
        let q2 = EventQueue(store: FileEventStore(directory: dir))
        XCTAssertEqual(q2.count, 3)
        XCTAssertEqual(q2.ids, [e1.eventId, e2.eventId, e3.eventId], "order is preserved on disk")
    }

    func testEnqueuePersistsBeforeReturning() throws {
        let store = InMemoryEventStore()
        var queue = EventQueue(store: store)
        try queue.enqueue(makeEvent())
        XCTAssertEqual(store.saved.count, 1, "the event is on disk before enqueue returns")
    }

    func testEnqueueSurfacesPersistenceFailureAndDoesNotQueue() {
        var queue = EventQueue(store: FailingEventStore())
        XCTAssertThrowsError(try queue.enqueue(makeEvent()), "a persistence failure is surfaced, not swallowed")
        XCTAssertEqual(queue.count, 0, "a failed persist is not pretended-queued")
    }

    // MARK: - completedIds mapping (accepted / duplicate / discarded / partial)

    func testCompletedIdsTreatsAcceptedDuplicateAndDiscardedAsCompleted() {
        let sent = [makeEvent(), makeEvent(), makeEvent()]
        let response = BatchUploadResponse(
            accepted: 1, duplicates: 1,
            discarded: [DiscardedEvent(eventId: sent[2].eventId, reason: "invalid_session")]
        )
        let completed = EventUploader.completedIds(sent: sent, response: response)
        XCTAssertEqual(completed, Set(sent.map(\.eventId)), "accepted + duplicate + discarded all complete")
    }

    func testCompletedIdsPartialKeepsUnaccountedButDropsExplicitDiscards() {
        let sent = [makeEvent(), makeEvent(), makeEvent()]
        // Server accounted for only 2 of 3 (1 accepted + 1 discarded) — a partial result.
        let response = BatchUploadResponse(
            accepted: 1, duplicates: 0,
            discarded: [DiscardedEvent(eventId: sent[2].eventId, reason: "invalid_session")]
        )
        let completed = EventUploader.completedIds(sent: sent, response: response)
        XCTAssertEqual(completed, Set([sent[2].eventId]), "only the explicitly-discarded id is safe to drop")
    }

    // MARK: - Flush removal semantics

    func testFlushRemovesCompletedEvents() async {
        let pipeline = EventPipeline(config: unconfigured(), store: InMemoryEventStore(), uploader: StubUploader())
        await pipeline.record(.activityStarted, sessionId: "s", templateId: "t")
        await pipeline.record(.activityEnded, sessionId: "s", templateId: "t")
        await pipeline.flush()
        let count = await pipeline.queuedCount()
        XCTAssertEqual(count, 0, "accepted/duplicate/discarded events are removed after upload")
    }

    func testFlushKeepsEventsOnUploadFailure() async {
        let stub = StubUploader(); stub.setMode(.fail)
        let pipeline = EventPipeline(config: unconfigured(), store: InMemoryEventStore(), uploader: stub)
        await pipeline.record(.activityStarted, sessionId: "s", templateId: "t")
        await pipeline.flush()
        let count = await pipeline.queuedCount()
        XCTAssertEqual(count, 1, "a network/server failure keeps events on disk for retry")
    }

    func testFlushPartialRemovesOnlyCompletedIds() async {
        let stub = StubUploader()
        let pipeline = EventPipeline(config: unconfigured(), store: InMemoryEventStore(), uploader: stub)
        await pipeline.record(.activityStarted, sessionId: "s", templateId: "t")
        await pipeline.record(.activityEnded, sessionId: "s", templateId: "t")
        let ids = await pipeline.queuedIds()
        stub.setMode(.complete([ids[0]])) // only the first event is completed

        await pipeline.flush()
        let remaining = await pipeline.queuedIds()
        XCTAssertEqual(remaining, [ids[1]], "only the completed id is removed; the rest is retained, in order")
    }

    func testAppendingDuringFlushDoesNotDropEvents() async {
        let stub = StubUploader() // completeAll
        let pipeline = EventPipeline(config: unconfigured(), store: InMemoryEventStore(), uploader: stub)
        await pipeline.record(.activityStarted, sessionId: "s", templateId: "t")
        await pipeline.record(.activityEnded, sessionId: "s", templateId: "t")
        // During the first upload, append a third event (actor reentrancy at the await).
        stub.setHook { await pipeline.record(.activityOpened, sessionId: "s", templateId: "t") }

        await pipeline.flush()

        let uploaded = Set(stub.received.flatMap { $0 }.map(\.eventId))
        XCTAssertEqual(uploaded.count, 3, "the event appended during the flush was uploaded, not dropped")
        let count = await pipeline.queuedCount()
        XCTAssertEqual(count, 0)
    }

    // MARK: - Corruption

    func testCorruptQueueFileIsQuarantinedAndStartsEmpty() throws {
        let dir = tempDir()
        let fileURL = dir.appendingPathComponent("events.json")
        try Data("this is not valid json".utf8).write(to: fileURL)

        let queue = EventQueue(store: FileEventStore(directory: dir))
        XCTAssertEqual(queue.count, 0, "a corrupt file loads as an empty queue, never a crash")
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: fileURL.appendingPathExtension("corrupt").path),
            "the corrupt file is moved aside for inspection",
        )
    }
}
