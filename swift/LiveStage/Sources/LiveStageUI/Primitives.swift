#if os(iOS)
import SwiftUI
import LiveStageModels

/// A thin rounded progress bar (build spec §6).
@available(iOS 16.2, *)
struct ProgressBar: View {
    let value: Double
    let tint: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.16))
                Capsule()
                    .fill(tint)
                    .frame(width: max(0, min(1, value)) * geo.size.width)
            }
        }
        .frame(height: 6)
    }
}

/// A circular progress ring with a centered icon - used by Journey/Progress minimal & expanded (build spec §6).
@available(iOS 16.2, *)
struct ProgressRing: View {
    let value: Double
    let tint: Color
    let icon: Image

    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.18), lineWidth: 3)
            Circle()
                .trim(from: 0, to: max(0, min(1, value)))
                .stroke(tint, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
            icon
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(tint)
        }
    }
}

/// A self-ticking countdown that updates on-device with no per-second server pushes
/// (build spec §6, design §02 "Time fields"). Uses `Text(timerInterval:)` (iOS 16+).
///
/// Past the target the system can't count a negative interval; if a `zeroLabel` is supplied
/// (Countdown's `zeroStateLabel`, design §05) it is shown instead of `0:00`. NOTE: whether the
/// enclosing branch re-evaluates *automatically* at the target while the app is untouched is the
/// M2 zero-flip spike question - see CountdownViews and the spike report.
@available(iOS 16.2, *)
struct CountdownText: View {
    let date: Date
    var zeroLabel: String? = nil

    var body: some View {
        if date > Date() {
            Text(timerInterval: Date()...date, countsDown: true)
                .monospacedDigit()
        } else if let zeroLabel, !zeroLabel.isEmpty {
            Text(zeroLabel)
        } else {
            Text("0:00").monospacedDigit()
        }
    }
}

/// Shared fixed width for the Dynamic Island **compact** trailing slot across every template, so
/// the compact pill is the same length for Journey / Countdown / Progress (design: the compact pill
/// has a consistent size; values are right-pinned within it). Sized to fit the longest typical value
/// ("1h 42m", "MM:SS"); longer values shrink via `minimumScaleFactor` rather than widening the pill.
@available(iOS 16.2, *)
let liveStageCompactTrailingWidth: CGFloat = 40

/// The expanded-view artwork tile: a rounded square holding the template glyph, sized like an
/// album-art cover (Apple Music parity) so it fills the left side of the expanded row and anchors
/// the title/subtitle beside it instead of a small lonely circle.
@available(iOS 16.2, *)
func expandedArtwork(_ iconIdentifier: String, accent: Color) -> some View {
    RoundedRectangle(cornerRadius: 12, style: .continuous)
        .fill(accent.opacity(0.18))
        .frame(width: 50, height: 50)
        .overlay(
            liveStageIcon(iconIdentifier)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(accent)
        )
        // Lift the cover a notch above the (centered) text so its top sits higher - the text then
        // reads as centered against the cover, shrinking the perceived gap above (Apple Music look).
        // `.offset` shifts it visually without changing the row's layout height.
        .offset(y: -4)
}

/// The countdown timer as it appears in the Dynamic Island **compact** trailing slot.
///
/// `Text(timerInterval:)` (inside `CountdownText`) has no settled intrinsic width while it ticks,
/// so in a compact region ActivityKit reserves a large fixed-width slot for it - which balloons
/// the whole island wide, left-pins the leading icon, and pushes the value out of view. We pin the
/// slot to the shared `liveStageCompactTrailingWidth` so the pill matches the other templates and
/// stays tight: short values (`0:00`, `MM:SS`) sit at full size, a long `H:MM:SS` shrinks to fit
/// via `minimumScaleFactor`. A fixed `.frame(width:)` + `.minimumScaleFactor` - never `fixedSize()`,
/// which collapses/stops a `timerInterval` Text.
@available(iOS 16.2, *)
struct CompactCountdownText: View {
    let date: Date

    var body: some View {
        CountdownText(date: date)
            .font(.system(size: 15, weight: .semibold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)   // long H:MM:SS shrinks to fit rather than widening the island
            .foregroundStyle(.white)
            .frame(width: liveStageCompactTrailingWidth, alignment: .trailing)
    }
}

/// Coarse relative duration for a Journey `targetDate` ETA (design §04: "1h 42m"). Refreshes when
/// the activity state updates - it is not a per-second ticking clock (that is Countdown's hero).
@available(iOS 16.2, *)
func shortDuration(until date: Date) -> String {
    let secs = max(0, Int(date.timeIntervalSinceNow))
    let h = secs / 3600, m = (secs % 3600) / 60
    return h > 0 ? "\(h)h \(m)m" : "\(m)m"
}

/// Formats a 0…1 progress value as an integer percent string.
@available(iOS 16.2, *)
func percentString(_ value: Double) -> String {
    "\(Int((max(0, min(1, value)) * 100).rounded()))%"
}

/// Whether a payload is **visually** terminal (design §04/§06 "completed / terminal look"): progress
/// filled, or a countdown reached zero. Visual only - it never affects lifecycle (updates still apply
/// until `end`). Journey/Progress use `progress >= 1`; Countdown uses target reached.
@available(iOS 16.2, *)
func isCompleted(_ payload: TemplatePayload) -> Bool {
    switch payload {
    case .journey(let s):   return (s.progress ?? 0) >= 1
    case .progress(let s):  return s.progress >= 1
    case .countdown(let s): return s.targetDate <= Date()
    }
}

/// A muted accent for the completed look (design D7: "muted accent + checkmark").
@available(iOS 16.2, *)
func renderTint(_ accent: Color, completed: Bool) -> Color {
    completed ? accent.opacity(0.5) : accent
}

/// The completed checkmark badge (design D7), shown beside the icon/title when terminal.
@available(iOS 16.2, *)
struct CompletedBadge: View {
    var tint: Color
    var body: some View {
        Image(systemName: "checkmark.circle.fill")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(tint)
    }
}

/// The shared stale hint (design §07), shown on Lock Screen / expanded when ActivityKit marks the
/// activity stale. Honest wording ("May be outdated") plus the relative last-updated time; never
/// shown in compact/minimal, which stay clean.
@available(iOS 16.2, *)
struct StaleHint: View {
    let lastUpdatedAt: Date
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9))
            Text("May be outdated · updated").font(.caption2)
            Text(lastUpdatedAt, style: .relative).font(.caption2)
        }
        .foregroundStyle(.secondary)
    }
}
#endif
