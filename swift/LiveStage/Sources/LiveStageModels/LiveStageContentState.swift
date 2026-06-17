import Foundation

/// The dynamic `ContentState` of a Live Activity: a typed payload plus shared metadata
/// (build spec §4.2, design §07). Sent on `start` and every `update`.
public struct LiveStageContentState: Codable, Hashable, Sendable {
    public let payload: TemplatePayload
    public let metadata: StateMetadata

    public init(payload: TemplatePayload, metadata: StateMetadata) {
        self.payload = payload
        self.metadata = metadata
    }
}
