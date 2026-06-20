import Foundation
import LiveStageModels

/// The local event buffer (build spec §5.2), now **durable** (CP7): it is backed by an `EventStore`
/// so queued events survive app relaunch. Owned by the `EventPipeline` actor, so its mutation is
/// serialized by that actor — this type itself is a plain value over the store.
///
/// Order is preserved on disk (events append in arrival order); removal is by `eventId`, so the
/// pipeline removes exactly the events the server has accounted for (accepted, duplicate, or
/// permanently discarded) and retains the rest. `occurredAt` on each event makes minor reordering
/// harmless — correctness (no loss, no double count) matters more than perfect order.
struct EventQueue {
    private var events: [AnalyticsEvent]
    private let store: EventStore

    init(store: EventStore) {
        self.store = store
        // A missing or corrupt file loads as empty (the store quarantines corruption); never crash.
        self.events = (try? store.load()) ?? []
    }

    var isEmpty: Bool { events.isEmpty }
    var count: Int { events.count }
    var ids: [String] { events.map(\.eventId) }

    /// Appends and **persists before returning** (CP7 requirement 2). If persistence fails the append
    /// is rolled back and the error is rethrown, so the caller logs it instead of pretending the event
    /// was durably queued.
    mutating func enqueue(_ event: AnalyticsEvent) throws {
        events.append(event)
        do {
            try store.save(events)
        } catch {
            events.removeLast()
            throw error
        }
    }

    /// The oldest up-to-`max` events (FIFO), uploaded as one batch.
    func peekBatch(max: Int) -> [AnalyticsEvent] {
        Array(events.prefix(max))
    }

    /// Removes the given events and persists best-effort. If the persist fails, the events remain on
    /// disk and re-upload on the next launch — the server's `eventId` dedupe makes that safe.
    mutating func remove(ids: Set<String>) {
        guard !ids.isEmpty else { return }
        events.removeAll { ids.contains($0.eventId) }
        do {
            try store.save(events)
        } catch {
            LiveStageLog.debug("failed to persist queue after removing \(ids.count) event(s): \(error)")
        }
    }
}
