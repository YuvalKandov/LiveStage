#if os(iOS)
import SwiftUI
import ActivityKit
import LiveStageModels

/// Progress renderers for all four surfaces (design §06 field→region mapping + content-priority).
/// `progress` is required and drives every surface: compact = %, minimal = ring + icon. The
/// estimated completion shows as "Done HH:MM" (completionLabel + time). Completed = `progress >= 1`
/// (muted accent + checkmark, visual only - updates still apply until `end`).
@available(iOS 16.2, *)
enum ProgressViews {

    private static func completed(_ s: ProgressState) -> Bool { s.progress >= 1 }

    /// "Done HH:MM" from estimatedCompletionDate (design §06 expanded center / lock completion).
    @ViewBuilder
    private static func completionTime(_ s: ProgressState, label: String?) -> some View {
        if let date = s.estimatedCompletionDate {
            HStack(spacing: 3) {
                if let label, !label.isEmpty { Text(label) }
                Text(date, style: .time)
            }
        }
    }

    // MARK: - Lock Screen (all fields - design §06)

    static func lockScreen(
        _ state: ProgressState,
        attributes: LiveStageActivityAttributes,
        metadata: StateMetadata
    ) -> some View {
        let accent = renderTint(attributes.accentStyle.color, completed: completed(state))
        return VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                liveStageIcon(attributes.iconIdentifier)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(accent)
                if completed(state) { CompletedBadge(tint: accent) }
                Spacer()
                Text(metadata.lastUpdatedAt, style: .relative)
                    .font(.caption2).foregroundStyle(.secondary)
            }

            Text(state.title).font(.headline).lineLimit(2)
            if let stage = state.currentStage, !stage.isEmpty {
                Text(stage).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }

            ProgressBar(value: state.progress, tint: accent).padding(.vertical, 2)

            HStack(alignment: .firstTextBaseline) {
                if let detail = state.detailText, !detail.isEmpty {
                    Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                completionTime(state, label: attributes.labels.completionLabel)
                    .font(.caption).fontWeight(.semibold).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 4)
    }

    // MARK: - Dynamic Island · compact (leading icon, trailing percent - always present)

    static func compactLeading(_ attributes: LiveStageActivityAttributes) -> some View {
        liveStageIcon(attributes.iconIdentifier).foregroundStyle(attributes.accentStyle.color)
    }

    static func compactTrailing(_ state: ProgressState, attributes: LiveStageActivityAttributes) -> some View {
        // Right-pinned within the shared compact width so the pill matches Journey/Countdown.
        Text(percentString(state.progress))
            .font(.system(size: 15, weight: .semibold)).monospacedDigit()
            .foregroundStyle(.white)
            .lineLimit(1).minimumScaleFactor(0.7)
            .frame(width: liveStageCompactTrailingWidth, alignment: .trailing)
    }

    // MARK: - Dynamic Island · minimal (progress ring + icon - design §06)

    static func minimal(_ state: ProgressState, attributes: LiveStageActivityAttributes) -> some View {
        // The ring (Circle) has no intrinsic size in the minimal slot; pin it or it renders blank.
        ProgressRing(value: state.progress, tint: attributes.accentStyle.color,
                     icon: liveStageIcon(attributes.iconIdentifier))
            .frame(width: 20, height: 20)
    }

    // MARK: - Dynamic Island · expanded regions (design §06)

    /// Expanded center: the whole top row, Apple-Music style - album-art tile, then title + stage, then
    /// the hero percentage + completion time on the right, all vertically centered. Built as one row in
    /// the wide center region (the leading slot beside the camera is too narrow); leading/trailing are
    /// unused (design §06).
    static func expandedCenter(_ state: ProgressState, attributes: LiveStageActivityAttributes) -> some View {
        let accent = renderTint(attributes.accentStyle.color, completed: completed(state))
        return HStack(spacing: 11) {
            expandedArtwork(attributes.iconIdentifier, accent: accent)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(state.title).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                    if completed(state) { CompletedBadge(tint: accent) }
                }
                if let stage = state.currentStage, !stage.isEmpty {
                    Text(stage).font(.system(size: 14)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(percentString(state.progress))
                    .font(.system(size: 16, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(accent).fixedSize()
                completionTime(state, label: attributes.labels.completionLabel)
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                    .lineLimit(1).fixedSize(horizontal: true, vertical: false)
            }
        }
    }

    /// Expanded bottom: progress bar + detailText; the bar takes full width when no detail (design §06).
    static func expandedBottom(_ state: ProgressState, attributes: LiveStageActivityAttributes) -> some View {
        HStack(spacing: 10) {
            ProgressBar(value: state.progress,
                        tint: renderTint(attributes.accentStyle.color, completed: completed(state)))
                .frame(maxWidth: .infinity)    // the bar flexes; the detail keeps its natural width beside it
            if let detail = state.detailText, !detail.isEmpty {
                Text(detail)
                    .font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)   // don't let the greedy bar clip it
            }
        }
    }
}
#endif
