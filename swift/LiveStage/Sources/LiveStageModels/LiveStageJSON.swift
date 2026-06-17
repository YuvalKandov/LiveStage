import Foundation

/// The shared SDK↔backend JSON coder (build spec §4.7).
///
/// Dates are encoded/decoded as ISO 8601 strings so the wire bytes match the documented
/// sample (`"2026-06-14T16:42:00Z"`). This is the coder the SDK and backend networking use;
/// ActivityKit serializes `ContentState` internally with its own coder (which round-trips
/// with itself - see the `Codable` tests).
public enum LiveStageJSON {
    public static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    public static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
