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

/// Classifies whether a failed `update` is a true synchronization failure (build spec §4.8/§8.6).
/// `sync_failed` is **narrow**: it covers transport (`.network`) and server (`.server`: 5xx/401/403)
/// failures only. A server-**rejected** update — `.validation` (400), `.alreadyEnded` (409), a
/// `.versionConflict`, or a `.sessionNotFound` — is measured server-side as a rejected update and is
/// **not** a sync failure. Decoding is a separate breakdown. Pure, so it is unit-tested directly.
enum SyncFailureClassifier {
    /// The `reason` qualifier for a `sync_failed` event, or nil when the error is not a sync failure.
    static func failureReason(for error: Error) -> String? {
        switch error {
        case LiveStageError.network: return "network"
        case LiveStageError.server:  return "server"
        default:                     return nil
        }
    }
}
