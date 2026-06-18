import Foundation

/// Reads the local-dev configuration injected via `DevelopmentSecrets.xcconfig` (build spec §11, §12).
/// The values arrive as Info.plist entries (`LiveStageAPIKey`, `LiveStageAPIHost`) expanded from the
/// xcconfig build settings at build time. The base URL is composed here because xcconfig values can't
/// contain `//`, so only the host (e.g. `localhost:8787`) is injected.
enum DemoConfig {
    static var apiKey: String {
        (Bundle.main.object(forInfoDictionaryKey: "LiveStageAPIKey") as? String) ?? ""
    }

    static var baseURL: URL {
        let host = (Bundle.main.object(forInfoDictionaryKey: "LiveStageAPIHost") as? String) ?? "localhost:8787"
        return URL(string: "http://\(host)") ?? URL(string: "http://localhost:8787")!
    }

    /// True once a non-empty key has been injected (helps the UI tell the developer to set it up).
    static var isConfigured: Bool { !apiKey.isEmpty }
}
