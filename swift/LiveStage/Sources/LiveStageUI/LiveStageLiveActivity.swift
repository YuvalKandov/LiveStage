#if os(iOS)
import SwiftUI
import WidgetKit
import ActivityKit
import LiveStageModels

/// The single `ActivityConfiguration` for every LiveStage template (build spec §6).
/// A top-level `switch context.state.payload` routes each surface to the per-template renderer.
/// M0 implements **Journey**; Countdown/Progress render a placeholder until M2.
@available(iOS 16.2, *)
public struct LiveStageLiveActivity: Widget {
    public init() {}

    public var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveStageActivityAttributes.self) { context in
            // Lock Screen / banner presentation.
            lockScreen(context)
                .padding(14)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { expandedLeading(context) }
                DynamicIslandExpandedRegion(.center) { expandedCenter(context) }
                DynamicIslandExpandedRegion(.trailing) { expandedTrailing(context) }
                DynamicIslandExpandedRegion(.bottom) { expandedBottom(context) }
            } compactLeading: {
                compactLeading(context)
            } compactTrailing: {
                compactTrailing(context)
            } minimal: {
                minimal(context)
            }
            .widgetURL(context.attributes.deepLinkURL)
            .keylineTint(context.attributes.accentStyle.color)
        }
    }

    private typealias Context = ActivityViewContext<LiveStageActivityAttributes>

    @ViewBuilder private func lockScreen(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):
            JourneyViews.lockScreen(s, attributes: context.attributes, metadata: context.state.metadata)
        case .countdown, .progress:
            placeholder(context)   // M2
        }
    }

    @ViewBuilder private func compactLeading(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey:
            JourneyViews.compactLeading(context.attributes)
        case .countdown, .progress:
            liveStageIcon(context.attributes.iconIdentifier).foregroundStyle(context.attributes.accentStyle.color)
        }
    }

    @ViewBuilder private func compactTrailing(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):
            JourneyViews.compactTrailing(s, attributes: context.attributes)
        case .countdown, .progress:
            EmptyView()
        }
    }

    @ViewBuilder private func minimal(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):
            JourneyViews.minimal(s, attributes: context.attributes)
        case .countdown, .progress:
            liveStageIcon(context.attributes.iconIdentifier).foregroundStyle(context.attributes.accentStyle.color)
        }
    }

    @ViewBuilder private func expandedLeading(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):
            JourneyViews.expandedLeading(s, attributes: context.attributes)
        case .countdown, .progress:
            placeholder(context)   // M2
        }
    }

    @ViewBuilder private func expandedCenter(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):
            JourneyViews.expandedCenter(s)
        case .countdown, .progress:
            EmptyView()
        }
    }

    @ViewBuilder private func expandedTrailing(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):
            JourneyViews.expandedTrailing(s, attributes: context.attributes)
        case .countdown, .progress:
            EmptyView()
        }
    }

    @ViewBuilder private func expandedBottom(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):
            JourneyViews.expandedBottom(s, attributes: context.attributes)
        case .countdown, .progress:
            EmptyView()
        }
    }

    // Placeholder for not-yet-implemented templates (Countdown/Progress land in M2).
    @ViewBuilder private func placeholder(_ context: Context) -> some View {
        HStack(spacing: 8) {
            liveStageIcon(context.attributes.iconIdentifier)
                .foregroundStyle(context.attributes.accentStyle.color)
            Text(context.attributes.templateType.rawValue.capitalized)
                .font(.subheadline).foregroundStyle(.secondary)
        }
    }
}
#endif
