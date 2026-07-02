import SwiftUI

/// Two surfaces over one controller: the Trips tab is the presentation face (what a real app with
/// LiveStage looks like), the Developer tab is the raw test harness. Both drive the same sessions.
struct ContentView: View {
    @StateObject private var controller = LiveActivityController()

    var body: some View {
        TabView {
            TripsView(controller: controller)
                .tabItem {
                    Label("Trips", systemImage: "airplane")
                }
            DeveloperView(controller: controller)
                .tabItem {
                    Label("Developer", systemImage: "wrench.and.screwdriver")
                }
        }
        // Debug-only: `-autostartTwo` launch arg starts both activities so the minimal
        // Dynamic Island presentation can be verified without manual taps. No effect normally.
        .task {
            if ProcessInfo.processInfo.arguments.contains("-autostartTwo") {
                controller.startJourney()
                controller.startSecondJourney()
            }
        }
    }
}

#Preview {
    ContentView()
}
