import Foundation

/// Thread-safe holder for `configure(apiKey:baseURL:)`. Lives outside the actor so the synchronous
/// public `configure` can set it without an async hop; the runtime reads it to build an `APIClient`.
final class ConfigStore: @unchecked Sendable {
    private let lock = NSLock()
    private var apiKey: String?
    private var baseURL: URL?

    func set(apiKey: String, baseURL: URL) {
        lock.lock(); defer { lock.unlock() }
        self.apiKey = apiKey
        self.baseURL = baseURL
    }

    func current() throws -> (apiKey: String, baseURL: URL) {
        lock.lock(); defer { lock.unlock() }
        guard let apiKey, let baseURL else { throw LiveStageError.notConfigured }
        return (apiKey, baseURL)
    }
}

/// The forward-only sync rule (build spec §9): apply a polled version only if it is newer than the
/// last one applied. A response with `version <= applied` is ignored (handles duplicates and
/// out-of-order responses). Pure so it is unit-tested directly.
enum SyncDecision {
    static func shouldApply(incoming: Int, applied: Int) -> Bool {
        incoming > applied
    }
}
