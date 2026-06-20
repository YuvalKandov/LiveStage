import Foundation
import LiveStageModels

/// Durable backing for the event queue (build spec §5.2/§5.4). Implemented by `FileEventStore` in the
/// app and by in-memory fakes in tests. `load` returns the persisted events (empty on a missing or
/// corrupt file); `save` writes the full ordered list.
protocol EventStore: Sendable {
    func load() throws -> [AnalyticsEvent]
    func save(_ events: [AnalyticsEvent]) throws
}

/// File-backed event queue persisted as a JSON array in Application Support, so analytics events
/// **survive app relaunch** (CP7). InstallationId stays in `UserDefaults`; only the event queue needs
/// durable file storage. Writes are atomic. A corrupt file is **quarantined** (moved aside) and the
/// queue starts empty rather than crashing or looping (CP7 requirement 6).
final class FileEventStore: EventStore, @unchecked Sendable {
    private let fileURL: URL
    private let fileManager: FileManager

    init(fileManager: FileManager = .default, directory: URL? = nil) {
        self.fileManager = fileManager
        let dir = directory ?? Self.defaultDirectory(fileManager)
        try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("events.json")
    }

    private static func defaultDirectory(_ fm: FileManager) -> URL {
        let base = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? fm.temporaryDirectory
        return base.appendingPathComponent("LiveStage", isDirectory: true)
    }

    func load() throws -> [AnalyticsEvent] {
        guard fileManager.fileExists(atPath: fileURL.path) else { return [] }
        let data = try Data(contentsOf: fileURL)
        if data.isEmpty { return [] }
        do {
            return try LiveStageJSON.decoder.decode([AnalyticsEvent].self, from: data)
        } catch {
            quarantine()
            LiveStageLog.debug("event queue file was corrupt; quarantined it and starting empty: \(error)")
            return []
        }
    }

    func save(_ events: [AnalyticsEvent]) throws {
        let data = try LiveStageJSON.encoder.encode(events)
        try data.write(to: fileURL, options: .atomic)
    }

    /// Moves the corrupt file aside (overwriting any prior quarantine) so it can be inspected but no
    /// longer blocks the queue.
    private func quarantine() {
        let badURL = fileURL.appendingPathExtension("corrupt")
        try? fileManager.removeItem(at: badURL)
        try? fileManager.moveItem(at: fileURL, to: badURL)
    }
}
