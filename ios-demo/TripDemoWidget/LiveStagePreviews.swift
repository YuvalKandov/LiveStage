#if DEBUG
import ActivityKit
import LiveStageModels
import LiveStageUI
import SwiftUI
import WidgetKit

// Xcode canvas previews for every Live Activity presentation. The **minimal** presentation is
// only shown on-device when 2+ activities are live (the system composites attached + detached
// minimal circles), and the iOS Simulator does not reliably render the secondary/detached one -
// so this preview is the dependable way to verify the minimal view in isolation.
@available(iOS 16.2, *)
private extension LiveStageActivityAttributes {
    static var previewJourney: LiveStageActivityAttributes {
        .init(
            sessionId: "preview",
            templateId: "trip-status",
            templateType: .journey,
            iconIdentifier: "airplane",
            accentStyle: .blue,
            labels: .init(nextStepLabel: "Next", targetLabel: "Departs in"),
            deepLinkURL: URL(string: "triptogether://trip?tripId=123")!
        )
    }
}

@available(iOS 16.2, *)
private extension LiveStageContentState {
    static var previewJourney: LiveStageContentState {
        .init(
            payload: .journey(.init(
                title: "Trip to Rome",
                currentStep: "Heading to the airport",
                nextStep: "Flight AZ809",
                progress: 0.35,
                targetDate: Date().addingTimeInterval(102 * 60),
                statusText: "On time"
            )),
            metadata: .init(lastUpdatedAt: Date(), version: 1)
        )
    }
}

@available(iOS 17.0, *)
#Preview("Lock Screen", as: .content, using: LiveStageActivityAttributes.previewJourney) {
    LiveStageLiveActivity()
} contentStates: {
    LiveStageContentState.previewJourney
}

@available(iOS 17.0, *)
#Preview("DI · Compact", as: .dynamicIsland(.compact), using: LiveStageActivityAttributes.previewJourney) {
    LiveStageLiveActivity()
} contentStates: {
    LiveStageContentState.previewJourney
}

@available(iOS 17.0, *)
#Preview("DI · Expanded", as: .dynamicIsland(.expanded), using: LiveStageActivityAttributes.previewJourney) {
    LiveStageLiveActivity()
} contentStates: {
    LiveStageContentState.previewJourney
}

@available(iOS 17.0, *)
#Preview("DI · Minimal", as: .dynamicIsland(.minimal), using: LiveStageActivityAttributes.previewJourney) {
    LiveStageLiveActivity()
} contentStates: {
    LiveStageContentState.previewJourney
}
#endif
