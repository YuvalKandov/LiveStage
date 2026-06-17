import SwiftUI

struct ContentView: View {
    @StateObject private var controller = LiveActivityController()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Live Activities") {
                        Text(controller.areActivitiesEnabled ? "Enabled" : "Disabled")
                            .foregroundStyle(controller.areActivitiesEnabled ? .green : .red)
                    }
                    LabeledContent("Active sessions") {
                        Text("\(controller.liveSessionIds.count)")
                    }
                } header: {
                    Text("Status")
                } footer: {
                    if !controller.areActivitiesEnabled {
                        Text("Enable Live Activities in Settings to test on this device.")
                    }
                }

                Section("Journey activity (M0 - hardcoded, local)") {
                    Button {
                        controller.startPrimary()
                    } label: {
                        Label("Start", systemImage: "play.fill")
                    }

                    Button {
                        controller.updatePrimary()
                    } label: {
                        Label("Update", systemImage: "arrow.clockwise")
                    }
                    .disabled(!controller.liveSessionIds.contains("demo-session-1"))

                    Button {
                        controller.endAll()
                    } label: {
                        Label("End all", systemImage: "stop.fill")
                    }
                    .disabled(controller.liveSessionIds.isEmpty)
                    .tint(.red)
                }

                Section {
                    Button {
                        controller.startSecond()
                    } label: {
                        Label("Start second activity", systemImage: "plus.square.on.square")
                    }
                } footer: {
                    Text("The minimal Dynamic Island presentation appears only when Live Activities from two DIFFERENT apps are live (e.g. this one + a Clock timer). Two activities from this same app stack on the Lock Screen but don't reliably show minimal in the Island.")
                }
            }
            .navigationTitle("TripDemo")
        }
        // Debug-only: `-autostartTwo` launch arg starts both activities so the minimal
        // Dynamic Island presentation can be verified without manual taps. No effect normally.
        .task {
            if ProcessInfo.processInfo.arguments.contains("-autostartTwo") {
                controller.startPrimary()
                controller.startSecond()
            }
        }
    }
}

#Preview {
    ContentView()
}
