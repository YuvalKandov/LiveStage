#if os(iOS)
import SwiftUI
import WidgetKit
import ActivityKit
import LiveStageModels

/// The single `ActivityConfiguration` for every LiveStage template (build spec §6).
/// A top-level `switch context.state.payload` routes each surface to the per-template renderer
/// (Journey / Countdown / Progress). Stale handling is shared here: when `context.isStale`, the
/// Lock Screen and expanded surfaces de-emphasize and show a `StaleHint`; compact/minimal stay
/// clean (design §07). The completed look is handled inside each renderer (it derives from state).
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
                DynamicIslandExpandedRegion(.leading) { expandedLeading(context).opacity(staleDim(context)) }
                DynamicIslandExpandedRegion(.center) { expandedCenter(context).opacity(staleDim(context)) }
                DynamicIslandExpandedRegion(.trailing) { expandedTrailing(context).opacity(staleDim(context)) }
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

    /// De-emphasis factor for stale Lock Screen / expanded content (design §07).
    private func staleDim(_ context: Context) -> Double { context.isStale ? 0.55 : 1 }

    // MARK: - Lock Screen

    @ViewBuilder private func lockScreen(_ context: Context) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            switch context.state.payload {
            case .journey(let s):
                JourneyViews.lockScreen(s, attributes: context.attributes, metadata: context.state.metadata)
            case .countdown(let s):
                CountdownViews.lockScreen(s, attributes: context.attributes, metadata: context.state.metadata)
            case .progress(let s):
                ProgressViews.lockScreen(s, attributes: context.attributes, metadata: context.state.metadata)
            }
            if context.isStale {
                StaleHint(lastUpdatedAt: context.state.metadata.lastUpdatedAt).padding(.horizontal, 4)
            }
        }
        .opacity(staleDim(context))
    }

    // MARK: - Compact (clean when stale)

    @ViewBuilder private func compactLeading(_ context: Context) -> some View {
        liveStageIcon(context.attributes.iconIdentifier).foregroundStyle(context.attributes.accentStyle.color)
    }

    @ViewBuilder private func compactTrailing(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):   JourneyViews.compactTrailing(s, attributes: context.attributes)
        case .countdown(let s): CountdownViews.compactTrailing(s, attributes: context.attributes)
        case .progress(let s):  ProgressViews.compactTrailing(s, attributes: context.attributes)
        }
    }

    @ViewBuilder private func minimal(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):   JourneyViews.minimal(s, attributes: context.attributes)
        case .countdown:        CountdownViews.minimal(context.attributes)
        case .progress(let s):  ProgressViews.minimal(s, attributes: context.attributes)
        }
    }

    // MARK: - Expanded regions

    @ViewBuilder private func expandedLeading(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):   JourneyViews.expandedLeading(s, attributes: context.attributes)
        case .countdown(let s): CountdownViews.expandedLeading(s, attributes: context.attributes)
        case .progress(let s):  ProgressViews.expandedLeading(s, attributes: context.attributes)
        }
    }

    @ViewBuilder private func expandedCenter(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):   JourneyViews.expandedCenter(s)
        case .countdown(let s): CountdownViews.expandedCenter(s)
        case .progress(let s):  ProgressViews.expandedCenter(s, attributes: context.attributes)
        }
    }

    @ViewBuilder private func expandedTrailing(_ context: Context) -> some View {
        switch context.state.payload {
        case .journey(let s):   JourneyViews.expandedTrailing(s, attributes: context.attributes)
        case .countdown(let s): CountdownViews.expandedTrailing(s, attributes: context.attributes)
        case .progress(let s):  ProgressViews.expandedTrailing(s, attributes: context.attributes)
        }
    }

    @ViewBuilder private func expandedBottom(_ context: Context) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Group {
                switch context.state.payload {
                case .journey(let s):   JourneyViews.expandedBottom(s, attributes: context.attributes)
                case .countdown(let s): CountdownViews.expandedBottom(s)
                case .progress(let s):  ProgressViews.expandedBottom(s, attributes: context.attributes)
                }
            }
            .opacity(staleDim(context))
            if context.isStale {
                StaleHint(lastUpdatedAt: context.state.metadata.lastUpdatedAt)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)   // keep bottom content left-aligned, not centered
        // The bottom region runs full-width into both rounded corners (unlike leading/trailing, which
        // the system insets), so its first/last glyphs clip without this horizontal clearance.
        .padding(.horizontal, 12)
    }
}
#endif
