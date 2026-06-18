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
                    LabeledContent("Backend key") {
                        Text(DemoConfig.isConfigured ? "Configured" : "Missing")
                            .foregroundStyle(DemoConfig.isConfigured ? .green : .red)
                    }
                    LabeledContent("Backend URL") {
                        Text(DemoConfig.baseURL.absoluteString).foregroundStyle(.secondary)
                    }
                    LabeledContent("Active sessions") {
                        Text("\(controller.liveSessionIds.count)")
                    }
                } header: {
                    Text("Status")
                } footer: {
                    if !DemoConfig.isConfigured {
                        Text("Set ios-demo/DevelopmentSecrets.xcconfig with the seeded mobile key (cd backend && npm run seed), then run the backend (npm run dev).")
                    } else if !controller.areActivitiesEnabled {
                        Text("Enable Live Activities in Settings to test on this device.")
                    }
                }

                Section("Journey activity (M1 - server-backed via the SDK)") {
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
                    .disabled(controller.primarySessionId == nil)

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

                if let error = controller.lastError {
                    Section("Last error") {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
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
