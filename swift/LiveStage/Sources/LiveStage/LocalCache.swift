import Foundation
import LiveStageModels

/// The last applied state the SDK retains for one session (build spec §5.2: `LocalCache` holds the
/// "last applied state per session"). Caching the full `LiveStageContentState` keeps the cache faithful
/// to §5.2 and lets `status` answer offline (version + lastUpdatedAt come from `state.metadata`). This
/// is the SDK's own durable cache, not an analytics event, so the content-free rule (which governs
/// `analytics_events` only) does not apply here.
struct CachedSession: Codable, Sendable {
    let sessionId: String
    let state: LiveStageContentState
    let status: String              // "active" | "ended" (server lifecycle, §8.5)
    let staleAfterSeconds: Int
    // Persisted so a cold-start deep-link tap (the app process was killed; the tap relaunched it)
    // can still be matched back to its session and recorded. Optional: older cache files lack them.
    var deepLinkURL: String? = nil  // the composed primary URL, source-stripped form
    var templateId: String? = nil
}

/// The whole on-disk cache snapshot: last known template configs + last applied state per session.
struct CacheSnapshot: Codable, Sendable {
    var configs: [String: TemplateConfiguration] = [:]
    var sessions: [String: CachedSession] = [:]
}

/// Durable local cache (build spec §5.2/§5.4) so the SDK degrades gracefully offline:
/// `fetchConfiguration` and `status` serve the last known value when the network is down. Implemented
/// by `FileLocalCache` in the app and by an in-memory fake in tests.
protocol LocalCache: Sendable {
    func config(for templateId: String) -> TemplateConfiguration?
    func putConfig(_ config: TemplateConfiguration)
    func session(for sessionId: String) -> CachedSession?
    func putSession(_ session: CachedSession)
    /// All cached sessions, for lookups not keyed by sessionId (the cold-start deep-link match).
    func sessions() -> [CachedSession]
}

/// File-backed `LocalCache` persisted as a single JSON snapshot in Application Support, mirroring
/// `FileEventStore`: writes are atomic, and a corrupt file is **quarantined** (moved aside) so the
/// cache starts empty rather than crashing or looping. Read-modify-write is serialized by a lock; in
/// practice the only caller is the `LiveStageRuntime` actor, but the lock keeps it correct regardless.
final class FileLocalCache: LocalCache, @unchecked Sendable {
    private let fileURL: URL
    private let fileManager: FileManager
    private let lock = NSLock()

    init(fileManager: FileManager = .default, directory: URL? = nil) {
        self.fileManager = fileManager
        let dir = directory ?? Self.defaultDirectory(fileManager)
        try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("cache.json")
    }

    private static func defaultDirectory(_ fm: FileManager) -> URL {
        let base = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? fm.temporaryDirectory
        return base.appendingPathComponent("LiveStage", isDirectory: true)
    }

    func config(for templateId: String) -> TemplateConfiguration? {
        lock.lock(); defer { lock.unlock() }
        return load().configs[templateId]
    }

    func putConfig(_ config: TemplateConfiguration) {
        lock.lock(); defer { lock.unlock() }
        var snapshot = load()
        snapshot.configs[config.templateId] = config
        save(snapshot)
    }

    func session(for sessionId: String) -> CachedSession? {
        lock.lock(); defer { lock.unlock() }
        return load().sessions[sessionId]
    }

    func putSession(_ session: CachedSession) {
        lock.lock(); defer { lock.unlock() }
        var snapshot = load()
        snapshot.sessions[session.sessionId] = session
        save(snapshot)
    }

    func sessions() -> [CachedSession] {
        lock.lock(); defer { lock.unlock() }
        return Array(load().sessions.values)
    }

    // MARK: - Disk (callers hold `lock`)

    private func load() -> CacheSnapshot {
        guard fileManager.fileExists(atPath: fileURL.path) else { return CacheSnapshot() }
        guard let data = try? Data(contentsOf: fileURL), !data.isEmpty else { return CacheSnapshot() }
        do {
            return try LiveStageJSON.decoder.decode(CacheSnapshot.self, from: data)
        } catch {
            quarantine()
            LiveStageLog.debug("local cache file was corrupt; quarantined it and starting empty: \(error)")
            return CacheSnapshot()
        }
    }

    private func save(_ snapshot: CacheSnapshot) {
        guard let data = try? LiveStageJSON.encoder.encode(snapshot) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Moves the corrupt file aside (overwriting any prior quarantine) so it can be inspected but no
    /// longer blocks the cache.
    private func quarantine() {
        let badURL = fileURL.appendingPathExtension("corrupt")
        try? fileManager.removeItem(at: badURL)
        try? fileManager.moveItem(at: fileURL, to: badURL)
    }
}
