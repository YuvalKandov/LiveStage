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
