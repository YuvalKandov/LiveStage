import Foundation

/// The three semantic templates LiveStage supports (build spec §4.5).
public enum TemplateType: String, Codable, Hashable, CaseIterable, Sendable {
    case journey
    case countdown
    case progress
}

/// Fixed accent palette mapped to iOS system colors (build spec §4.5, design §04).
/// Validation rejects anything outside this set.
public enum AccentStyle: String, Codable, Hashable, CaseIterable, Sendable {
    case blue
    case orange
    case green
    case indigo
    case teal
}
