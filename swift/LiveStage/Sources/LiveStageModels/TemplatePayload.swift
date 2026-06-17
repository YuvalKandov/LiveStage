import Foundation

/// The typed template state (build spec §4.2).
///
/// Wire format (build spec §4.7) is **flattened**: the `"type"` discriminator sits at the
/// same level as the state's own fields, not nested:
///
/// ```json
/// { "type": "journey", "title": "Trip to Rome", "currentStep": "...", "progress": 0.35 }
/// ```
///
/// The custom `Codable` below produces exactly that shape so the SDK and the backend
/// (which mirrors these types in TypeScript) agree byte-for-byte.
public enum TemplatePayload: Codable, Hashable, Sendable {
    case journey(JourneyState)
    case countdown(CountdownState)
    case progress(ProgressState)

    /// Only the discriminator lives at this level; the rest of the keys belong to the
    /// concrete state and are decoded/encoded straight onto the same coder.
    private enum CodingKeys: String, CodingKey {
        case type
    }

    private enum Kind: String, Codable {
        case journey
        case countdown
        case progress
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .type) {
        case .journey:
            self = .journey(try JourneyState(from: decoder))
        case .countdown:
            self = .countdown(try CountdownState(from: decoder))
        case .progress:
            self = .progress(try ProgressState(from: decoder))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .journey(let state):
            try container.encode(Kind.journey, forKey: .type)
            try state.encode(to: encoder)
        case .countdown(let state):
            try container.encode(Kind.countdown, forKey: .type)
            try state.encode(to: encoder)
        case .progress(let state):
            try container.encode(Kind.progress, forKey: .type)
            try state.encode(to: encoder)
        }
    }

    /// Convenience: the template type implied by the payload case.
    public var templateType: TemplateType {
        switch self {
        case .journey:   return .journey
        case .countdown: return .countdown
        case .progress:  return .progress
        }
    }
}
