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
@available(iOS 16.2, *)
struct CountdownText: View {
    let date: Date

    var body: some View {
        if date > Date() {
            Text(timerInterval: Date()...date, countsDown: true)
                .monospacedDigit()
        } else {
            // Past target: the system can't count a negative interval; show zero.
            Text("0:00").monospacedDigit()
        }
    }
}

/// Formats a 0…1 progress value as an integer percent string.
@available(iOS 16.2, *)
func percentString(_ value: Double) -> String {
    "\(Int((max(0, min(1, value)) * 100).rounded()))%"
}
#endif
