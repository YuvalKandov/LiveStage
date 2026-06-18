import Foundation

/// Static wording supplied by the template configuration (build spec §4.4).
/// These are constants for a template - never re-sent per update (design §02 decision log).
public struct TemplateLabels: Codable, Hashable, Sendable {
    public let nextStepLabel: String?
    public let targetLabel: String?
    public let countdownLabel: String?
    public let completionLabel: String?
    /// Countdown only: shown in place of the timer once it reaches zero (design §05). It is the
    /// single source of truth for the zero label - the renderer reads it from the frozen
    /// attributes, so the server folds the `zero_state_label` DB column into here at start.
    public let zeroStateLabel: String?

    public init(
        nextStepLabel: String? = nil,
        targetLabel: String? = nil,
        countdownLabel: String? = nil,
        completionLabel: String? = nil,
        zeroStateLabel: String? = nil
    ) {
        self.nextStepLabel = nextStepLabel
        self.targetLabel = targetLabel
        self.countdownLabel = countdownLabel
        self.completionLabel = completionLabel
        self.zeroStateLabel = zeroStateLabel
    }
}
