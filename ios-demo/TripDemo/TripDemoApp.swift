import SwiftUI
import LiveStage

@main
struct TripDemoApp: App {
    init() {
        // Point the SDK at the local backend using the injected key + host (build spec §11).
        LiveStage.configure(apiKey: DemoConfig.apiKey, baseURL: DemoConfig.baseURL)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                // Route LiveStage deep links through the SDK. handleDeepLink returns the matched
                // session + parameters + source, and records the interaction (activity_opened for a
                // primary tap, expanded_action_tapped for the expanded Link).
                .onOpenURL { url in
                    Task {
                        if let route = try? await LiveStage.handleDeepLink(url) {
                            print("[TripDemo] deep link -> session=\(route.sessionId) params=\(route.parameters) source=\(route.source)")
                        } else {
                            print("[TripDemo] opened via URL (no LiveStage session matched): \(url.absoluteString)")
                        }
                    }
                }
        }
    }
}
