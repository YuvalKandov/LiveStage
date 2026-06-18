#if os(iOS)
import SwiftUI
import ActivityKit
import LiveStageModels

/// Journey renderers for all four surfaces (design §04 field→region mapping + content-priority rules).
/// Priority/fallback is expressed as small deterministic enums/helpers rather than scattered
/// inline conditionals (build spec §6).
@available(iOS 16.2, *)
enum JourneyViews {

    // MARK: - Deterministic content priority (design §04 "Content-priority rules", locked)

    /// Compact / expanded trailing: targetDate countdown → progress % → statusText → icon only.
    enum TrailingContent {
        case countdown(Date)
        case percent(Double)
        case status(String)
        case iconOnly

        static func resolve(_ s: JourneyState, allowStatus: Bool) -> TrailingContent {
            if let date = s.targetDate { return .countdown(date) }
            if let p = s.progress { return .percent(p) }
            if allowStatus, let status = s.statusText, !status.isEmpty { return .status(status) }
            return .iconOnly
        }
    }

    // MARK: - Lock Screen (all fields - design §04)

    static func lockScreen(
        _ state: JourneyState,
        attributes: LiveStageActivityAttributes,
        metadata: StateMetadata
    ) -> some View {
        let accent = attributes.accentStyle.color
        return VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                liveStageIcon(attributes.iconIdentifier)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(accent)
                if let status = state.statusText, !status.isEmpty {
                    Text(status).font(.caption).fontWeight(.semibold).foregroundStyle(accent)
                }
                Spacer()
                Text(metadata.lastUpdatedAt, style: .relative)
                    .font(.caption2).foregroundStyle(.secondary)
            }

            Text(state.title)
                .font(.headline)
                .lineLimit(2)               // Lock Screen: up to 2 lines (design §04 long-title)
            Text(state.currentStep)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            if let progress = state.progress {
                ProgressBar(value: progress, tint: accent).padding(.vertical, 2)
            }

            HStack(alignment: .firstTextBaseline) {
                if let nextStep = state.nextStep {
                    Text(footerLeft(label: attributes.labels.nextStepLabel, value: nextStep))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                if let date = state.targetDate {
                    HStack(spacing: 4) {
                        if let label = attributes.labels.targetLabel {
                            Text(label).font(.caption).foregroundStyle(.secondary)
                        }
                        CountdownText(date: date).font(.caption).fontWeight(.semibold)
                    }
                }
            }
        }
        .padding(.horizontal, 4)
    }

    private static func footerLeft(label: String?, value: String) -> String {
        if let label, !label.isEmpty { return "\(label) · \(value)" }
        return value
    }

    // MARK: - Dynamic Island · compact

    static func compactLeading(_ attributes: LiveStageActivityAttributes) -> some View {
        liveStageIcon(attributes.iconIdentifier).foregroundStyle(attributes.accentStyle.color)
    }

    @ViewBuilder
    static func compactTrailing(_ state: JourneyState, attributes: LiveStageActivityAttributes) -> some View {
        // Consistent compact-trailing style across all templates: size-to-content, no width cap
        // (so a long countdown like "1:41:50" isn't truncated).
        switch TrailingContent.resolve(state, allowStatus: true) {
        case .countdown(let date):
            CountdownText(date: date).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
        case .percent(let p):
            Text(percentString(p)).font(.system(size: 15, weight: .semibold)).monospacedDigit().foregroundStyle(.white)
        case .status(let text):
            Text(text).font(.system(size: 13, weight: .medium)).foregroundStyle(.white).lineLimit(1)
        case .iconOnly:
            EmptyView()
        }
    }

    // MARK: - Dynamic Island · minimal (progress ring + icon → plain icon - design §04, D2)

    @ViewBuilder
    static func minimal(_ state: JourneyState, attributes: LiveStageActivityAttributes) -> some View {
        let icon = liveStageIcon(attributes.iconIdentifier)
        if let progress = state.progress {
            // The ring is built from Circle(), which has no intrinsic size - without an explicit
            // frame it collapses to nothing in the minimal slot (renders blank). Pin its size.
            ProgressRing(value: progress, tint: attributes.accentStyle.color, icon: icon)
                .frame(width: 20, height: 20)
        } else {
            icon.foregroundStyle(attributes.accentStyle.color)
        }
    }

    // MARK: - Dynamic Island · expanded regions (design §04)

    static func expandedLeading(_ state: JourneyState, attributes: LiveStageActivityAttributes) -> some View {
        HStack(spacing: 9) {
            ZStack {
                Circle().fill(Color.white.opacity(0.12)).frame(width: 30, height: 30)
                liveStageIcon(attributes.iconIdentifier)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(attributes.accentStyle.color)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(state.title).font(.system(size: 14, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.7)
                Text(state.currentStep).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }

    @ViewBuilder
    static func expandedCenter(_ state: JourneyState) -> some View {
        if let status = state.statusText, !status.isEmpty {
            Text(status).font(.system(size: 12)).foregroundStyle(.secondary)
        }
    }

    /// Expanded trailing: targetDate countdown → progress %.
    @ViewBuilder
    static func expandedTrailing(_ state: JourneyState, attributes: LiveStageActivityAttributes) -> some View {
        if let date = state.targetDate {
            CountdownText(date: date)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(attributes.accentStyle.color)
                .frame(maxWidth: 70)
        } else if let progress = state.progress {
            Text(percentString(progress))
                .font(.system(size: 17, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(attributes.accentStyle.color)
                .fixedSize()                   // keep the % at its natural width (don't clip the left digit)
        }
    }

    /// Expanded bottom: nextStep + progress bar; one full-width if only one; removed if both absent.
    @ViewBuilder
    static func expandedBottom(_ state: JourneyState, attributes: LiveStageActivityAttributes) -> some View {
        let hasNext = (state.nextStep?.isEmpty == false)
        let hasProgress = state.progress != nil
        if hasNext || hasProgress {
            HStack(spacing: 10) {
                if let nextStep = state.nextStep, !nextStep.isEmpty {
                    Text(footerLeft(label: attributes.labels.nextStepLabel, value: nextStep))
                        .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                }
                if let progress = state.progress {
                    ProgressBar(value: progress, tint: attributes.accentStyle.color)
                }
            }
        }
    }
}
#endif
