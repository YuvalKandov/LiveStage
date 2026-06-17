import Foundation

#if os(iOS)
import ActivityKit

/// Slim, renderer-only static data fixed for the lifetime of one activity (build spec §4.1, design §07).
/// Kept under Apple's 4 KB attributes cap. `projectId`/`displayName` stay server/portal-side.
///
/// Guarded with `#if os(iOS)` (ActivityKit's `ActivityAttributes` is marked unavailable on macOS,
/// so `canImport` alone isn't enough) so the package still builds and tests on the macOS host -
/// where the `Codable` round-trip test runs without a simulator. On iOS the Widget Extension and
/// demo app get the full `ActivityAttributes` conformance.
@available(iOS 16.2, *)
public struct LiveStageActivityAttributes: ActivityAttributes {
    public typealias ContentState = LiveStageContentState

    public let sessionId: String          // our backend/session id ↔ ActivityKit Activity.id
    public let templateId: String
    public let templateType: TemplateType // .journey | .countdown | .progress
    public let iconIdentifier: String     // from the SF Symbol allowlist
    public let accentStyle: AccentStyle
    public let labels: TemplateLabels
    public let deepLinkURL: URL            // final, validated - composed before start

    public init(
        sessionId: String,
        templateId: String,
        templateType: TemplateType,
        iconIdentifier: String,
        accentStyle: AccentStyle,
        labels: TemplateLabels,
        deepLinkURL: URL
    ) {
        self.sessionId = sessionId
        self.templateId = templateId
        self.templateType = templateType
        self.iconIdentifier = iconIdentifier
        self.accentStyle = accentStyle
        self.labels = labels
        self.deepLinkURL = deepLinkURL
    }
}
#endif
