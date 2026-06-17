import SwiftUI
import WidgetKit
import LiveStageUI

/// The Widget Extension's entry point (build spec §7). A developer adopting LiveStage registers
/// `LiveStageLiveActivity()` here - the activity views themselves live in the reusable `LiveStageUI`
/// package, so app and extension share one definition.
@main
struct TripDemoWidgetBundle: WidgetBundle {
    var body: some Widget {
        LiveStageLiveActivity()
    }
}
