import Foundation

/// The SDK error model (build spec §5.3). Errors carry actionable messages, never silent failures.
public enum LiveStageError: Error, Sendable {
    case notConfigured
    case activityKitUnavailable                 // device/sim without Live Activities
    case validation(field: String, message: String)
    case network(underlying: Error)
    case server(status: Int, message: String)
    case sessionNotFound
    case alreadyEnded
    case versionConflict(server: Int, attempted: Int)
    case unsupportedTemplate(String)
    case decoding(Error)
}

extension LiveStageError: CustomStringConvertible {
    public var description: String {
        switch self {
        case .notConfigured:
            return "LiveStage.configure(apiKey:baseURL:) must be called before any other API."
        case .activityKitUnavailable:
            return "Live Activities are not available (disabled, or the device/simulator does not support them)."
        case let .validation(field, message):
            return "Validation failed for \(field): \(message)"
        case let .network(underlying):
            return "Network error: \(underlying)"
        case let .server(status, message):
            return "Server error \(status): \(message)"
        case .sessionNotFound:
            return "No such activity session."
        case .alreadyEnded:
            return "The activity has already ended; updates are rejected."
        case let .versionConflict(server, attempted):
            return "Version conflict (server \(server), attempted \(attempted))."
        case let .unsupportedTemplate(id):
            return "Unsupported template: \(id)"
        case let .decoding(error):
            return "Failed to decode a response: \(error)"
        }
    }
}
