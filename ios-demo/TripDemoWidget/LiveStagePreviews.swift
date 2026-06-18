#if DEBUG
import ActivityKit
import LiveStageModels
import LiveStageUI
import SwiftUI
import WidgetKit

// Xcode canvas previews for every Live Activity presentation across all three templates. The
// **minimal** presentation is only shown on-device when 2+ activities are live; these previews are
// the dependable way to verify each surface in isolation. Stale appearance (context.isStale) cannot
// be forced in a preview - verify it on-device with the 20s `stale-demo` template.
@available(iOS 16.2, *)
private extension LiveStageActivityAttributes {
    static var previewJourney: LiveStageActivityAttributes {
        .init(sessionId: "preview", templateId: "trip-status", templateType: .journey,
              iconIdentifier: "airplane", accentStyle: .blue,
              labels: .init(nextStepLabel: "Next", targetLabel: "Departs in"),
              deepLinkURL: URL(string: "triptogether://trip?tripId=123")!)
    }
    static var previewCountdown: LiveStageActivityAttributes {
        .init(sessionId: "preview", templateId: "flight-countdown", templateType: .countdown,
              iconIdentifier: "clock", accentStyle: .orange,
              labels: .init(countdownLabel: "Boarding in", zeroStateLabel: "Boarding now"),
              deepLinkURL: URL(string: "triptogether://flight?flightId=AZ809")!)
    }
    static var previewProgress: LiveStageActivityAttributes {
        .init(sessionId: "preview", templateId: "order-progress", templateType: .progress,
              iconIdentifier: "shippingbox", accentStyle: .green,
              labels: .init(completionLabel: "Done"),
              deepLinkURL: URL(string: "triptogether://order?orderId=42")!)
    }
}

@available(iOS 16.2, *)
private extension LiveStageContentState {
    static var journey: LiveStageContentState {
        .init(payload: .journey(.init(title: "Trip to Rome", currentStep: "Heading to the airport",
                                      nextStep: "Flight AZ809", progress: 0.35,
                                      targetDate: Date().addingTimeInterval(102 * 60), statusText: "On time")),
              metadata: .init(lastUpdatedAt: Date(), version: 1))
    }
    static var countdown: LiveStageContentState {
        .init(payload: .countdown(.init(title: "Flight to Rome", subtitle: "Gate B12",
                                        targetDate: Date().addingTimeInterval(28 * 60),
                                        statusText: "On time", location: "Terminal 3")),
              metadata: .init(lastUpdatedAt: Date(), version: 1))
    }
    static var countdownZero: LiveStageContentState {
        .init(payload: .countdown(.init(title: "Flight to Rome", subtitle: "Gate B12",
                                        targetDate: Date().addingTimeInterval(-5),
                                        statusText: "Boarding", location: "Terminal 3")),
              metadata: .init(lastUpdatedAt: Date(), version: 2))
    }
    static var progress: LiveStageContentState {
        .init(payload: .progress(.init(title: "Preparing your order", currentStage: "Packing",
                                       progress: 0.72, estimatedCompletionDate: Date().addingTimeInterval(18 * 60),
                                       detailText: "3 items left")),
              metadata: .init(lastUpdatedAt: Date(), version: 1))
    }
    static var progressDone: LiveStageContentState {
        .init(payload: .progress(.init(title: "Preparing your order", currentStage: "Done",
                                       progress: 1.0, estimatedCompletionDate: Date(), detailText: nil)),
              metadata: .init(lastUpdatedAt: Date(), version: 2))
    }
}

// MARK: - Journey

@available(iOS 17.0, *)
#Preview("Journey · Lock", as: .content, using: LiveStageActivityAttributes.previewJourney) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.journey }

@available(iOS 17.0, *)
#Preview("Journey · Compact", as: .dynamicIsland(.compact), using: LiveStageActivityAttributes.previewJourney) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.journey }

@available(iOS 17.0, *)
#Preview("Journey · Expanded", as: .dynamicIsland(.expanded), using: LiveStageActivityAttributes.previewJourney) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.journey }

@available(iOS 17.0, *)
#Preview("Journey · Minimal", as: .dynamicIsland(.minimal), using: LiveStageActivityAttributes.previewJourney) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.journey }

// MARK: - Countdown (scrub between the running state and the zero state)

@available(iOS 17.0, *)
#Preview("Countdown · Lock", as: .content, using: LiveStageActivityAttributes.previewCountdown) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.countdown; LiveStageContentState.countdownZero }

@available(iOS 17.0, *)
#Preview("Countdown · Compact", as: .dynamicIsland(.compact), using: LiveStageActivityAttributes.previewCountdown) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.countdown; LiveStageContentState.countdownZero }

@available(iOS 17.0, *)
#Preview("Countdown · Expanded", as: .dynamicIsland(.expanded), using: LiveStageActivityAttributes.previewCountdown) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.countdown; LiveStageContentState.countdownZero }

@available(iOS 17.0, *)
#Preview("Countdown · Minimal", as: .dynamicIsland(.minimal), using: LiveStageActivityAttributes.previewCountdown) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.countdown }

// MARK: - Progress (scrub between in-progress and completed)

@available(iOS 17.0, *)
#Preview("Progress · Lock", as: .content, using: LiveStageActivityAttributes.previewProgress) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.progress; LiveStageContentState.progressDone }

@available(iOS 17.0, *)
#Preview("Progress · Compact", as: .dynamicIsland(.compact), using: LiveStageActivityAttributes.previewProgress) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.progress; LiveStageContentState.progressDone }

@available(iOS 17.0, *)
#Preview("Progress · Expanded", as: .dynamicIsland(.expanded), using: LiveStageActivityAttributes.previewProgress) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.progress; LiveStageContentState.progressDone }

@available(iOS 17.0, *)
#Preview("Progress · Minimal", as: .dynamicIsland(.minimal), using: LiveStageActivityAttributes.previewProgress) {
    LiveStageLiveActivity()
} contentStates: { LiveStageContentState.progress }
#endif
