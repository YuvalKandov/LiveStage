import LiveStageModels
import SwiftUI

/// The presentation face of the demo: what a real travel app looks like with LiveStage in it. Three
/// cards, one per template, each backed by a real SDK session. A card mirrors the state its Live
/// Activity is showing; "Play demo" walks the trip through its whole life hands-free. Everything
/// here goes through the same `LiveActivityController` the Developer tab uses - no separate path.
struct TripsView: View {
    @ObservedObject var controller: LiveActivityController

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    SetupBanner(controller: controller)
                    ErrorBanner(controller: controller)
                    TripCard(controller: controller)
                    FlightCard(controller: controller)
                    DeliveryCard(controller: controller)

                    Text("Every card is a real LiveStage session: one start call with typed state, rendered natively on the Lock Screen and in the Dynamic Island, and updated live.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)

                    HStack(spacing: 6) {
                        Image(systemName: "bolt.fill")
                            .font(.caption2)
                        Text("Powered by LiveStage")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 2)
                }
                .padding(.horizontal)
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("LiveStage Demo")
        }
    }
}

// MARK: - The three cards

private struct TripCard: View {
    @ObservedObject var controller: LiveActivityController

    private var journey: JourneyState? {
        if case .journey(let s) = controller.payload(for: .trip) { return s }
        return nil
    }

    var body: some View {
        CardShell(
            icon: "airplane",
            tint: .blue,
            title: "Trip to Rome",
            subtitle: "Flight AZ809 · Fiumicino (FCO)",
            isLive: controller.isLive(.trip)
        ) {
            VStack(alignment: .leading, spacing: 12) {
                RouteRow()
                if let journey {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(journey.currentStep)
                                .font(.subheadline.weight(.medium))
                            Spacer()
                            if let status = journey.statusText {
                                Text(status)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        ProgressView(value: journey.progress ?? 0)
                            .tint(.blue)
                    }
                } else {
                    Text("Track this trip to follow it from the Lock Screen and the Dynamic Island.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        } actions: {
            if controller.isLive(.trip) {
                HStack(spacing: 10) {
                    Button {
                        controller.playDemo()
                    } label: {
                        Label(controller.isPlayingDemo ? "Playing…" : "Play demo", systemImage: "play.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(controller.isPlayingDemo)

                    Button("Advance") { controller.advance(.trip) }
                        .buttonStyle(.bordered)
                        .disabled(controller.isPlayingDemo)

                    Spacer()

                    Button("Stop", role: .destructive) { controller.stop(.trip) }
                        .buttonStyle(.bordered)
                }
            } else {
                HStack(spacing: 10) {
                    Button {
                        controller.track(.trip)
                    } label: {
                        Label("Track this trip", systemImage: "dot.radiowaves.left.and.right")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)

                    Button {
                        controller.playDemo()
                    } label: {
                        Label("Play demo", systemImage: "play.fill")
                    }
                    .buttonStyle(.bordered)
                }
                .disabled(!controller.isReady)
            }
        }
    }
}

private struct FlightCard: View {
    @ObservedObject var controller: LiveActivityController

    private var countdown: CountdownState? {
        if case .countdown(let s) = controller.payload(for: .flight) { return s }
        return nil
    }

    var body: some View {
        CardShell(
            icon: "timer",
            tint: .orange,
            title: "Boarding countdown",
            subtitle: "Flight AZ809 · Gate B12",
            isLive: controller.isLive(.flight)
        ) {
            if let countdown {
                // One `now` for both the comparison and the range (an inverted range would crash).
                let now = Date()
                HStack(alignment: .firstTextBaseline) {
                    // The card's own mirror of the self-ticking countdown the activity shows.
                    if countdown.targetDate > now {
                        Text(timerInterval: now...countdown.targetDate, countsDown: true)
                            .font(.title2.weight(.semibold).monospacedDigit())
                    } else {
                        Text("Boarding now")
                            .font(.title3.weight(.semibold))
                    }
                    Spacer()
                    if let status = countdown.statusText {
                        Text(status)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                Text("Start a countdown to boarding. At zero the activity flips to \u{201C}Boarding now\u{201D} on its own.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } actions: {
            if controller.isLive(.flight) {
                HStack(spacing: 10) {
                    Button("Final call") { controller.advance(.flight) }
                        .buttonStyle(.bordered)
                    Spacer()
                    Button("Stop", role: .destructive) { controller.stop(.flight) }
                        .buttonStyle(.bordered)
                }
            } else {
                Button {
                    controller.track(.flight)
                } label: {
                    Label("Start countdown", systemImage: "timer")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)
                .disabled(!controller.isReady)
            }
        }
    }
}

private struct DeliveryCard: View {
    @ObservedObject var controller: LiveActivityController

    private var progress: ProgressState? {
        if case .progress(let s) = controller.payload(for: .delivery) { return s }
        return nil
    }

    var body: some View {
        CardShell(
            icon: "shippingbox.fill",
            tint: .green,
            title: "Order #42",
            subtitle: "3 items · Aroma Coffee Roasters",
            isLive: controller.isLive(.delivery)
        ) {
            if let progress {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(progress.currentStage ?? "In progress")
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        if let detail = progress.detailText {
                            Text(detail)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    ProgressView(value: progress.progress)
                        .tint(.green)
                }
            } else {
                Text("Track the order while it is packed, shipped, and delivered.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } actions: {
            if controller.isLive(.delivery) {
                HStack(spacing: 10) {
                    Button("Advance") { controller.advance(.delivery) }
                        .buttonStyle(.bordered)
                    Spacer()
                    Button("Stop", role: .destructive) { controller.stop(.delivery) }
                        .buttonStyle(.bordered)
                }
            } else {
                Button {
                    controller.track(.delivery)
                } label: {
                    Label("Track delivery", systemImage: "shippingbox")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(!controller.isReady)
            }
        }
    }
}

/// The boarding-pass style route line on the trip card: origin and destination codes joined by a
/// dashed path with a plane on it.
private struct RouteRow: View {
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("TLV").font(.title3.weight(.bold))
                Text("Tel Aviv").font(.caption).foregroundStyle(.secondary)
            }
            DashLine()
            Image(systemName: "airplane")
                .font(.caption)
                .foregroundStyle(.secondary)
            DashLine()
            VStack(alignment: .trailing, spacing: 2) {
                Text("FCO").font(.title3.weight(.bold))
                Text("Rome").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

private struct DashLine: View {
    var body: some View {
        HLine()
            .stroke(style: StrokeStyle(lineWidth: 1.4, lineCap: .round, dash: [1, 6]))
            .foregroundStyle(.tertiary)
            .frame(height: 2)
            .frame(maxWidth: .infinity)
    }
}

private struct HLine: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 0, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
    }
}

// MARK: - Shared chrome

/// The shared card scaffold: icon tile, title/subtitle, a Live chip while the activity runs, then
/// the card's mirrored content and its action row.
private struct CardShell<Content: View, Actions: View>: View {
    let icon: String
    let tint: Color
    let title: String
    let subtitle: String
    let isLive: Bool
    @ViewBuilder let content: Content
    @ViewBuilder let actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(
                        LinearGradient(colors: [tint.opacity(0.8), tint], startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if isLive { LiveChip() }
            }
            content
            actions
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.05), radius: 10, y: 4)
    }
}

private struct LiveChip: View {
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(.green).frame(width: 7, height: 7)
            Text("Live")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.green)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Color.green.opacity(0.12), in: Capsule())
    }
}

/// Setup guidance when the demo cannot start yet (missing key or Live Activities disabled).
private struct SetupBanner: View {
    @ObservedObject var controller: LiveActivityController

    var body: some View {
        if !DemoConfig.isConfigured {
            BannerCard(
                icon: "key.fill",
                tint: .yellow,
                text: "Backend key missing. Set ios-demo/DevelopmentSecrets.xcconfig with the seeded mobile key (cd backend && npm run seed), then run the backend (npm run dev)."
            )
        } else if !controller.areActivitiesEnabled {
            BannerCard(
                icon: "bell.slash.fill",
                tint: .yellow,
                text: "Live Activities are disabled. Enable them in Settings to test on this device."
            )
        }
    }
}

private struct ErrorBanner: View {
    @ObservedObject var controller: LiveActivityController

    var body: some View {
        if let error = controller.lastError {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .lineLimit(4)
                Spacer(minLength: 0)
                Button {
                    controller.lastError = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

private struct BannerCard: View {
    let icon: String
    let tint: Color
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(tint)
            Text(text)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

#Preview {
    TripsView(controller: LiveActivityController())
}
