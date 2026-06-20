import Foundation

/// A minimal key/value store so `InstallationID` can persist to `UserDefaults` in the app and to an
/// in-memory store in unit tests. (`UserDefaults` already provides both methods.)
protocol KeyValueStore {
    func string(forKey defaultName: String) -> String?
    func set(_ value: String, forKey defaultName: String)
}

extension UserDefaults: KeyValueStore {
    func set(_ value: String, forKey defaultName: String) {
        set(value as Any, forKey: defaultName)
    }
}

/// The anonymous per-installation identifier (build spec §4.8, §5.2). Generated once on first run and
/// persisted in `UserDefaults` so it is **stable across launches** but unique per install. It is
/// **never** derived from device identifiers (IDFV/IDFA) and is **never** a user account id — it lets
/// the Insights API report *unique installations*, never "unique people."
enum InstallationID {
    static let storageKey = "com.livestage.installationId"

    /// Returns the persisted id, generating and storing one on first access.
    static func current(store: KeyValueStore = UserDefaults.standard) -> String {
        if let existing = store.string(forKey: storageKey), !existing.isEmpty {
            return existing
        }
        let generated = UUID().uuidString
        store.set(generated, forKey: storageKey)
        return generated
    }
}
