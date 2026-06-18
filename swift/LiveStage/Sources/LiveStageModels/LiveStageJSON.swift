import Foundation

/// The shared SDK↔backend JSON coder (build spec §4.7).
///
/// Dates are encoded as ISO 8601 strings so the wire matches the documented sample
/// (`"2026-06-14T16:42:00Z"`). Decoding is tolerant of **fractional seconds** because the backend
/// stamps server time with JavaScript's `Date.toISOString()` (e.g. `"2026-06-17T18:47:05.237Z"`),
/// which the stock `.iso8601` strategy rejects. This is the coder the SDK and backend networking
/// use; ActivityKit serializes `ContentState` internally with its own coder.
public enum LiveStageJSON {
    public static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    public static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = isoDate(raw) {
                return date
            }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Invalid ISO-8601 date: \(raw)")
            )
        }
        return decoder
    }()

    // Two formatters: one with fractional seconds (backend server stamps), one without (whole-second
    // dates like the documented sample). Try fractional first, then fall back.
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static func isoDate(_ raw: String) -> Date? {
        isoFractional.date(from: raw) ?? isoPlain.date(from: raw)
    }
}
