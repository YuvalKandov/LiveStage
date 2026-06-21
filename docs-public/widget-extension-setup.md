# Widget Extension setup

A Live Activity is rendered by a Widget Extension, a separate target from your app. LiveStage ships
the native views in the `LiveStageUI` package, so your extension is thin: it registers one widget
and links two packages. The `TripDemoWidget` target in `ios-demo/` is the reference starter; copy
its shape.

The extension sandbox has no network and no location access. All content reaches the views through
the activity's `ContentState`, which the SDK pushes from the app. The views never fetch anything.

## What the starter contains

`ios-demo/TripDemoWidget/` has:

- `TripDemoWidgetBundle.swift` - the `@main` `WidgetBundle` that registers the activity.
- `Info.plist` - the extension's plist.
- `LiveStagePreviews.swift` - SwiftUI previews of the templates (optional, for development).

The widget bundle is the whole entry point:

```swift
import SwiftUI
import WidgetKit
import LiveStageUI

@main
struct TripDemoWidgetBundle: WidgetBundle {
    var body: some Widget {
        LiveStageLiveActivity()
    }
}
```

`LiveStageLiveActivity` is one `ActivityConfiguration(for: LiveStageActivityAttributes.self)`. Its
Lock Screen closure renders the card; its `dynamicIsland` closure fills `compactLeading`,
`compactTrailing`, `minimal`, and the four expanded regions. A switch on the payload type routes to
the Journey, Countdown, or Progress renderer, so you do not add per-template views.

## Steps to add the extension to your app

1. **Add the target.** In Xcode: File > New > Target > Widget Extension. Give it a name (for
   example `MyAppWidget`). Xcode creates a target with its own Info.plist and a sample widget; you
   replace the sample with the bundle above.

2. **Link the packages.**
   - Add the `LiveStage` Swift package to the project (if you have not already).
   - Link `LiveStageUI` and `LiveStageModels` to the **widget extension** target.
   - Link `LiveStage` to the **app** target.

   The shared `LiveStageActivityAttributes` type lives in `LiveStageModels`, imported by both the
   app and the extension, so there is a single definition of the activity's attributes on both
   sides.

3. **Register the widget.** Replace the generated widget bundle with the `WidgetBundle` shown above,
   registering `LiveStageLiveActivity()`.

4. **Enable Live Activities in the app.** Set `NSSupportsLiveActivities` to `YES` in the **app**
   target's Info.plist (not the extension's).

5. **Optional: App Group.** Not required for V1 local updates. You would add a shared App Group only
   for sharing state via files or for later APNs work.

## Verifying it renders

Build and run the app on a simulator or device, then start an activity from your code (see the
integration guide). The Lock Screen card appears on any simulator. The Dynamic Island only appears
on a Pro simulator or device, so do not conclude rendering is broken from a non-Pro simulator. The
minimal Dynamic Island presentation only appears when two or more activities are live at once.

To build the demo extension from the command line:

```sh
xcodebuild -project ios-demo/TripDemo.xcodeproj -scheme TripDemo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

If you change `ios-demo/project.yml`, regenerate the project first:

```sh
xcodegen generate --spec ios-demo/project.yml
```

## Platform floor

LiveStage targets iOS 16.2 as the minimum. If you extend `LiveStageUI`, guard any iOS 17, 18, or
later API with `if #available`. App Intents buttons inside the activity are post-V1 and are not part
of the starter.
