import Foundation

/// Static template configuration (build spec §4.4). Authored in the portal, stored server-side, and
/// returned by `GET /v1/templates/:id` for the SDK's `fetchConfiguration`. Immutable for a running
/// activity: a portal edit affects new activities only (`attributes_json` is frozen at start).
///
/// `icon` is an allowlisted SF Symbol identifier (a `String` here, matching the renderer's
/// `iconIdentifier`); the server validates it against the allowlist on template create/edit.
public struct TemplateConfiguration: Codable, Hashable, Sendable {
    public let templateId: String
    public let templateType: TemplateType
    public let displayName: String
    public let icon: String
    public let accentStyle: AccentStyle
    public let deepLinkBase: String
    public let labels: TemplateLabels
    public let zeroStateLabel: String?
    public let staleAfterSeconds: Int

    public init(
        templateId: String,
        templateType: TemplateType,
        displayName: String,
        icon: String,
        accentStyle: AccentStyle,
        deepLinkBase: String,
        labels: TemplateLabels,
        zeroStateLabel: String? = nil,
        staleAfterSeconds: Int = 900
    ) {
        self.templateId = templateId
        self.templateType = templateType
        self.displayName = displayName
        self.icon = icon
        self.accentStyle = accentStyle
        self.deepLinkBase = deepLinkBase
        self.labels = labels
        self.zeroStateLabel = zeroStateLabel
        self.staleAfterSeconds = staleAfterSeconds
    }
}
