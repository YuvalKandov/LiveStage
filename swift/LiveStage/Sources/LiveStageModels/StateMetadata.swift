import Foundation

/// Update metadata shared across all templates (build spec §4.2).
/// `staleDate` is intentionally NOT here - it rides on `ActivityContent(state:staleDate:)`.
public struct StateMetadata: Codable, Hashable, Sendable {
    public let lastUpdatedAt: Date   // drives "Updated 12m ago"
    public let version: Int          // monotonic; rejects out-of-order / duplicate updates

    public init(lastUpdatedAt: Date, version: Int) {
        self.lastUpdatedAt = lastUpdatedAt
        self.version = version
    }
}
