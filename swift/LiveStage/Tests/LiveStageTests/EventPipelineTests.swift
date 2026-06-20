import XCTest
@testable import LiveStage
import LiveStageModels

/// Host-side tests for the analytics pipeline (build spec §4.8/§5.2): the event builder, the
/// anonymous installation id, and the in-memory queue. Emission timing and uploads are exercised in
/// the simulator and proven via curl (the runtime's emission points need ActivityKit + the backend).
final class EventPipelineTests: XCTestCase {

    /// Minimal in-memory KeyValueStore so InstallationID can be tested without touching UserDefaults.
    private final class MemoryStore: KeyValueStore {
        private var values: [String: String] = [:]
        func string(forKey defaultName: String) -> String? { values[defaultName] }
        func set(_ value: String, forKey defaultName: String) { values[defaultName] = value }
    }

    // MARK: - InstallationID

    func testInstallationIDGeneratesAndPersists() {
        let store = MemoryStore()
        let first = InstallationID.current(store: store)
        XCTAssertFalse(first.isEmpty)
        let second = InstallationID.current(store: store)
        XCTAssertEqual(first, second, "the id must be stable across calls (persisted in the store)")
    }

    func testInstallationIDIsPerStore() {
        let a = InstallationID.current(store: MemoryStore())
        let b = InstallationID.current(store: MemoryStore())
        XCTAssertNotEqual(a, b, "a fresh install (empty store) gets its own id")
    }

    // MARK: - EventTracker

    func testTrackerBuildsEventWithTypeVersionAndInstallation() {
        let tracker = EventTracker(installationId: "install-1")
        let event = tracker.make(.stateApplied, sessionId: "s1", templateId: "trip-status", version: 3)
        XCTAssertEqual(event.eventType, "state_applied")
        XCTAssertEqual(event.version, 3)
        XCTAssertEqual(event.sessionId, "s1")
        XCTAssertEqual(event.templateId, "trip-status")
        XCTAssertEqual(event.installationId, "install-1")
        XCTAssertFalse(event.eventId.isEmpty)
    }

    func testTrackerGeneratesUniqueEventIds() {
        let tracker = EventTracker(installationId: "install-1")
        let a = tracker.make(.activityStarted, sessionId: "s1", templateId: "t")
        let b = tracker.make(.activityStarted, sessionId: "s1", templateId: "t")
        XCTAssertNotEqual(a.eventId, b.eventId, "each event carries its own dedupe key")
    }

    func testTrackerKeepsOnlyAllowedMetadataKeys() {
        let tracker = EventTracker(installationId: "install-1")
        let event = tracker.make(
            .expandedActionTapped,
            sessionId: "s1",
            templateId: "t",
            metadata: ["source": "expanded_action", "title": "Trip to Rome", "location": "Rome"]
        )
        XCTAssertEqual(event.metadata, ["source": "expanded_action"], "content keys must be dropped")
    }

    func testTrackerDropsEmptyMetadata() {
        let tracker = EventTracker(installationId: "install-1")
        let event = tracker.make(.activityOpened, sessionId: "s1", templateId: "t", metadata: ["title": "x"])
        XCTAssertNil(event.metadata, "if no allowed key survives, metadata stays absent")
    }

    // MARK: - sync_failed is narrow (build spec §4.8/§8.6)

    func testSyncFailureClassifierCountsOnlyTransportAndServer() {
        XCTAssertEqual(SyncFailureClassifier.failureReason(for: LiveStageError.network(underlying: URLError(.timedOut))), "network")
        XCTAssertEqual(SyncFailureClassifier.failureReason(for: LiveStageError.server(status: 503, message: "down")), "server")
        // Server-rejected updates are NOT sync failures — they are counted as rejected_updates.
        XCTAssertNil(SyncFailureClassifier.failureReason(for: LiveStageError.validation(field: "progress", message: "out of range (1.4)")))
        XCTAssertNil(SyncFailureClassifier.failureReason(for: LiveStageError.alreadyEnded))
        XCTAssertNil(SyncFailureClassifier.failureReason(for: LiveStageError.versionConflict(server: 3, attempted: 2)))
        XCTAssertNil(SyncFailureClassifier.failureReason(for: LiveStageError.sessionNotFound))
    }

    // MARK: - EventQueue (durable; CP7 covers persistence, here just FIFO + remove)

    func testQueueIsFifoAndRemovesByID() throws {
        var queue = EventQueue(store: InMemoryEventStore())
        let tracker = EventTracker(installationId: "install-1")
        let e1 = tracker.make(.activityStarted, sessionId: "s1", templateId: "t")
        let e2 = tracker.make(.stateApplied, sessionId: "s1", templateId: "t", version: 2)
        let e3 = tracker.make(.activityEnded, sessionId: "s1", templateId: "t")
        try queue.enqueue(e1); try queue.enqueue(e2); try queue.enqueue(e3)
        XCTAssertEqual(queue.count, 3)

        let batch = queue.peekBatch(max: 2)
        XCTAssertEqual(batch.map(\.eventId), [e1.eventId, e2.eventId], "FIFO, capped at max")

        queue.remove(ids: Set(batch.map(\.eventId)))
        XCTAssertEqual(queue.count, 1)
        XCTAssertEqual(queue.peekBatch(max: 10).map(\.eventId), [e3.eventId])
    }
}
