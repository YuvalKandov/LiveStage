import SwiftUI

@main
struct TripDemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                // Proves the deep-link tap target opens the app (build spec §11).
                // Full LiveStage.handleDeepLink routing arrives with the SDK in M1/M3.
                .onOpenURL { url in
                    print("[TripDemo] opened via deep link: \(url.absoluteString)")
                }
        }
    }
}
