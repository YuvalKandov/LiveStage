#if os(iOS)
import SwiftUI
import ActivityKit
import LiveStageModels

/// Countdown renderers for all four surfaces (design §05 field→region mapping + content-priority).
/// The countdown is the hero value on every surface; minimal is icon-only (locked: a 2-char
/// countdown is ambiguous across locales/units). At zero the trailing/lock countdown shows the
/// template's `zeroStateLabel` (the SDK fires one local re-render at the target - see
/// `LiveStageRuntime.scheduleZeroTransition`). Completed = countdown at/after zero (muted + check).
@available(iOS 16.2, *)
enum CountdownViews {

    private static func completed(_ s: CountdownState) -> Bool { s.targetDate <= Date() }

    /// Lock-screen subtitle line: subtitle and location joined, or whichever exists (design §05).
    private static func subtitleLine(_ s: CountdownState) -> String? {
        let parts = [s.subtitle, s.location].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    // MARK: - Lock Screen (all fields - design §05)

    static func lockScreen(
        _ state: CountdownState,
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
                if let status = state.statusText, !status.isEmpty {
                    Text(status).font(.caption).fontWeight(.semibold).foregroundStyle(accent)
                }
                Spacer()
                Text(metadata.lastUpdatedAt, style: .relative)
                    .font(.caption2).foregroundStyle(.secondary)
            }

            Text(state.title).font(.headline).lineLimit(2)
            if let sub = subtitleLine(state) {
                Text(sub).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }

            HStack(alignment: .firstTextBaseline) {
                if let label = attributes.labels.countdownLabel {
                    Text(label).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                CountdownText(date: state.targetDate, zeroLabel: attributes.labels.zeroStateLabel)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(accent)
            }
        }
        .padding(.horizontal, 4)
    }

    // MARK: - Dynamic Island · compact (leading icon, trailing countdown - always present)

    static func compactLeading(_ attributes: LiveStageActivityAttributes) -> some View {
        liveStageIcon(attributes.iconIdentifier).foregroundStyle(attributes.accentStyle.color)
    }

    static func compactTrailing(_ state: CountdownState, attributes: LiveStageActivityAttributes) -> some View {
        // Compact stays tight (design "restraint in tight spaces"): at zero it shows a short "0:00",
        // not the full zeroStateLabel ("Boarding now") - that long label belongs on Lock/expanded.
        // CompactCountdownText bounds the timer's width so the island sizes to content instead of
        // stretching full-width (no fixedSize - it broke the self-ticking timer).
        CompactCountdownText(date: state.targetDate)
    }

    // MARK: - Dynamic Island · minimal (icon only in V1 - design §05, locked)

    static func minimal(_ attributes: LiveStageActivityAttributes) -> some View {
        liveStageIcon(attributes.iconIdentifier).foregroundStyle(attributes.accentStyle.color)
    }

    // MARK: - Dynamic Island · expanded regions (design §05)

    /// Expanded center: the whole top row, Apple-Music style - album-art tile, then title + subtitle,
    /// then the hero countdown + status on the right, all vertically centered. Built as one row in the
    /// wide center region (the leading slot beside the camera is too narrow); leading/trailing are
    /// unused. The timer keeps a one-line bounded frame (a ticking timerInterval can't use fixedSize -
    /// it would collapse) (design §05).
    static func expandedCenter(_ state: CountdownState, attributes: LiveStageActivityAttributes) -> some View {
        let accent = renderTint(attributes.accentStyle.color, completed: completed(state))
        return HStack(spacing: 11) {
            expandedArtwork(attributes.iconIdentifier, accent: accent)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(state.title).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                    if completed(state) { CompletedBadge(tint: accent) }
                }
                if let sub = state.subtitle, !sub.isEmpty {
                    Text(sub).font(.system(size: 14)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                CountdownText(date: state.targetDate, zeroLabel: attributes.labels.zeroStateLabel)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(width: 56, alignment: .trailing)
                if let status = state.statusText, !status.isEmpty {
                    Text(status).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
    }

    /// Expanded bottom: location with a pin (statusText now rides the trailing row, so it isn't
    /// repeated here); region removed when there's no location (design §05).
    @ViewBuilder
    static func expandedBottom(_ state: CountdownState) -> some View {
        if let location = state.location, !location.isEmpty {
            HStack(spacing: 6) {
                Image(systemName: "mappin").font(.system(size: 12)).foregroundStyle(.secondary)
                Text(location).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }
}
#endif
