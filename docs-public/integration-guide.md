# LiveStage integration guide

This guide adds LiveStage to a blank iOS app so that a Live Activity appears on the Lock Screen
and Dynamic Island, updates from your code or the portal, and records an open when the user taps
it. The goal is that a developer who has never seen this codebase can follow these steps end to
end.

LiveStage is server-configurable and state-driven: you choose a template and supply typed state,
and the SDK renders native SwiftUI compiled into your widget extension. You do not write the
Live Activity layout yourself; it lives in the `LiveStageUI` package.

## Prerequisites

- iOS 16.2 or later (Live Activities baseline). Guard any newer API you add with `if #available`.
- A running LiveStage backend with a seeded `mobile` key and at least one template. See the
  repository `README.md` for how to run the backend and seed it. The seeded templates include
  `trip-status` (journey), `flight-countdown` (countdown), and `order-progress` (progress).
- The Dynamic Island only renders on a Pro simulator or device. The Lock Screen renders anywhere.

## Step 1 - add the Swift package

Add the `LiveStage` package (the `swift/LiveStage` directory of this repo, or your fork's URL) to
your Xcode project. It exposes three library products:

- `LiveStage` - the SDK you call from the app.
- `LiveStageUI` - the native renderers and the `ActivityConfiguration`, used by the widget extension.
- `LiveStageModels` - the shared data contract used by both the app and the extension.

## Step 2 - add a Widget Extension target

File > New > Target > Widget Extension. Name it (for example) `MyAppWidget`. This target hosts the
Live Activity views. See `widget-extension-setup.md` for the full target setup; the short version:

- Link `LiveStageUI` and `LiveStageModels` to the **widget extension** target.
- Link `LiveStage` to the **app** target.
- In the extension's `@main` `WidgetBundle`, register the activity:

  ```swift
  import SwiftUI
  import WidgetKit
  import LiveStageUI

  @main
  struct MyAppWidgetBundle: WidgetBundle {
      var body: some Widget {
          LiveStageLiveActivity()
      }
  }
  ```

`LiveStageLiveActivity` is the single `ActivityConfiguration` that fills the Lock Screen card and
the compact, minimal, and expanded Dynamic Island regions for all three templates. You do not add
per-template views; the package routes on the payload type.

## Step 3 - enable Live Activities in the app Info.plist

Add to the **app** target's Info.plist:

```xml
<key>NSSupportsLiveActivities</key>
<true/>
```

If your backend runs over plain HTTP on localhost or a LAN IP during development, also allow local
networking in the app Info.plist:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
```

## Step 4 - register your URL scheme (for deep links)

The template's `deepLinkBase` uses a custom scheme (the demo uses `triptogether://`). Register your
scheme under `CFBundleURLTypes` in the app Info.plist so a tap on the activity opens your app:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>triptogether</string>
    </array>
  </dict>
</array>
```

## Step 5 - configure the SDK at launch

Call `configure` once before any other LiveStage call, for example in your `App.init`:

```swift
import SwiftUI
import LiveStage

@main
struct MyApp: App {
    init() {
        LiveStage.configure(
            apiKey: "ls_mobile_...",                       // your seeded mobile key
            baseURL: URL(string: "http://localhost:8787")! // your backend
        )
    }

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
```

Do not hardcode the key in source you commit. The demo app injects it from a gitignored xcconfig
(`ios-demo/DevelopmentSecrets.xcconfig`); see the README. The mobile key is not a true secret, but
keep it out of version control anyway.

## Step 6 - start, update, and end an activity

`start` must be called with the app in the foreground (an ActivityKit requirement). It fetches the
template configuration, validates your state, creates the server session, requests the activity,
and begins polling.

```swift
import LiveStage
import LiveStageModels

// Start a Journey activity.
let session = try await LiveStage.start(
    templateId: "trip-status",
    deepLinkParameters: ["tripId": "123"],
    state: .journey(JourneyState(
        title: "Trip to Rome",
        currentStep: "Heading to the airport",
        nextStep: "Flight AZ809",
        progress: 0.35,
        targetDate: Date().addingTimeInterval(3600),
        statusText: "On time"
    ))
)

// Update it later (the SDK renders the new state immediately, then keeps polling).
try await LiveStage.update(session, state: .journey(JourneyState(
    title: "Trip to Rome",
    currentStep: "Boarding at gate B12",
    progress: 0.6,
    statusText: "Delayed 10 min"
)))

// End it when the activity is done.
try await LiveStage.end(session)
```

`session` is a `LiveStageSession` value (a `sessionId` and `templateId`). Keep it to update, end,
or query status later. You can also drive updates from the portal: edit the session's state there
and the SDK applies the new server version within one poll interval.

Visual completion (progress at 1.0, a countdown at zero, a journey "arrived" status) renders the
completed look but does not lock the activity. Updates are accepted until you call `end`.

## Step 7 - handle the deep link and record the open

When the user taps the activity, iOS opens your app with the template's deep link. Route it through
`handleDeepLink` from `.onOpenURL`. This is what records the open:

```swift
.onOpenURL { url in
    Task {
        if let route = try await LiveStage.handleDeepLink(url) {
            // route.parameters is your deep-link parameters with the internal source removed,
            // e.g. ["tripId": "123"]. route.source is .primary or .expandedAction.
            // Navigate using route.parameters here.
        }
    }
}
```

How the recorded open works: the primary tap carries an internal `source=activity_open` query item,
so `handleDeepLink` records an `activity_opened` event. A tap on the explicit Link inside the
expanded Dynamic Island carries `source=expanded_action` and records `expanded_action_tapped`. The
SDK strips the `source` parameter before returning the route to you, so your navigation never sees
it. A URL with no source, an unknown source, or one that matches no known LiveStage session records
nothing and returns `nil` (for `nil`, treat it as a normal app URL).

There is no "user expanded" or impression event. The expand gesture is handled by the system and a
SwiftUI render does not prove a human saw it, so `expanded_action_tapped` is a separate intentional
tap, not an expansion count.

## Step 8 - verify the recorded open

After tapping the activity and reopening the app, confirm the open was recorded. Query the Insights
API with a `service` key (not the mobile key):

```sh
curl -s http://localhost:8787/v1/insights/summary \
  -H "Authorization: Bearer ls_service_..."
```

The response includes opens and the interaction rate. You can also open the portal's analytics
dashboard and session explorer to see the same numbers and the per-session timeline; see
[portal-guide.md](portal-guide.md) for what each console screen does.

## Analytics: automatic, and how to read it

You do not instrument analytics. The SDK emits the typed events on its own as the activity lives:
`activity_started`, `state_applied`, `activity_ended`, and `sync_failed` are reported by
`start`, `update`, the polling engine, and `end` without any extra calls from you. The **only**
wiring you add is Step 7's `handleDeepLink`, which is what turns a tap into an `activity_opened` or
`expanded_action_tapped` event. Events are queued, persisted to disk, batched, and deduped by
`eventId`, so you never count or upload anything yourself.

Each event carries identifiers and types only (session, anonymous installation, template, event
type, version, timestamps), never any of your state content and never a user identity.

To read the results, the server aggregates the events and exposes the **Insights API** behind a
`service` key. The portal's Analytics tab visualizes these same endpoints:

| Endpoint | What it returns |
| --- | --- |
| `GET /v1/insights/summary?from&to` | The four hero metrics (apply-success rate, acknowledged sync latency, interaction rate, update-rejection rate), the secondary `lateApplicationRate`, and supporting totals (sessions, opens, unique installations, updates, sync failures), each rate with its raw numerator and denominator. |
| `GET /v1/insights/templates/:templateId?from&to` | The same summary scoped to one template. |
| `GET /v1/insights/sessions/:sessionId` | The ordered event timeline for one session, with the acknowledged latency per applied version. Identifiers and types only, no content. |
| `GET /v1/insights/timeseries?metric&from&to&interval=day[&templateId]` | Per-day chart rows for one metric (for example `opens`, `updateRejectionRate`, `applySuccessRate`, `interactionRate`, `averageLatencyMs`). |

The range is optional ISO dates; omitting `from`/`to` covers all time. All four routes require a
`service` key and reject a `mobile` key.

## Error handling

Every SDK call throws `LiveStageError`, which conforms to `LocalizedError`, so
`error.localizedDescription` carries an actionable message. Map cases as needed:

| Case | When it happens | `localizedDescription` |
| --- | --- | --- |
| `.notConfigured` | a call before `configure` | LiveStage.configure(apiKey:baseURL:) must be called before any other API. |
| `.activityKitUnavailable` | Live Activities disabled, or unsupported device/simulator | Live Activities are not available (disabled, or the device/simulator does not support them). |
| `.validation(field:message:)` | the backend rejected the payload (HTTP 400) | Validation failed for {field}: {message} |
| `.network(underlying:)` | a transport failure after retries | Network error: {underlying} |
| `.server(status:message:)` | HTTP 401/403, a non-ended 409, or 5xx after retries | Server error {status}: {message} |
| `.sessionNotFound` | unknown session (HTTP 404) | No such activity session. |
| `.alreadyEnded` | an update or end after the session ended (HTTP 409 already_ended) | The activity has already ended; updates are rejected. |
| `.versionConflict(server:attempted:)` | a version conflict | Version conflict (server {server}, attempted {attempted}). |
| `.unsupportedTemplate(_:)` | an unknown template id locally | Unsupported template: {id} |
| `.decoding(_:)` | a response that could not be decoded | Failed to decode a response: {error} |

HTTP mapping: 400 to `.validation`, 401/403 to `.server`, 404 to `.sessionNotFound`, 409
(`already_ended`) to `.alreadyEnded` otherwise `.server`, 5xx to `.server` after retries, and any
transport failure to `.network`.

## Offline behavior

The SDK degrades gracefully when the network drops:

- The last applied state stays on the Lock Screen and Dynamic Island and goes stale via the
  activity's `staleDate`. Polling resumes on reconnect and applies the next forward version.
- `fetchConfiguration` and `status` serve the last known value from a durable local cache when
  offline; a fresh fetch wins when the network is back.
- An `update` that fails on the network surfaces `.network`; the last successful state remains on
  screen. `start` requires connectivity because it needs a server session id.
- Analytics events are persisted to disk, survive app relaunch, and upload when the app next
  returns to the foreground or on the next successful poll. Re-uploads are deduped by event id, so
  nothing is double-counted.

## Troubleshooting: nothing appears

If `start` returns but you see no activity, work down this list. Most first-run failures are setup,
not code:

- **Live Activities are off.** Settings > Face ID & Passcode (or the app's settings) > Live
  Activities must be enabled. If disabled, `start` throws `.activityKitUnavailable`.
- **Wrong simulator for the Dynamic Island.** The Dynamic Island only renders on a **Pro** simulator
  or device. The Lock Screen card renders anywhere, so check the Lock Screen first before concluding
  rendering is broken.
- **The minimal presentation looks missing.** The minimal Dynamic Island only appears when two or
  more activities are live at once; with one activity you see compact, not minimal.
- **`NSSupportsLiveActivities` missing.** It must be `YES` in the **app** target's Info.plist, not
  the extension's.
- **HTTP blocked in the simulator.** A local or LAN backend over plain HTTP needs the
  `NSAllowsLocalNetworking` App Transport Security entry from Step 3. Without it the SDK gets a
  network error and `start` fails.
- **`configure` not called, or called after `start`.** A call before `configure` throws
  `.notConfigured`. Configure once at launch.
- **401 / 403 from the backend.** The mobile key is stale or wrong. Re-seeding the backend rotates
  the keys, so resync `LIVESTAGE_API_KEY` in your xcconfig after `npm run seed`.
- **The activity shows but never updates.** Confirm the backend is running and reachable (LAN IP, not
  `localhost`, on a physical device), and that the session is still `active`. Updates apply within one
  poll interval (8s default); the portal's Logs tab shows rejections with a reason.
- **A tap records nothing.** The deep link must reach `handleDeepLink` from `.onOpenURL`, and your URL
  scheme must be registered (Step 4). A URL with no known `source` or no matching session returns
  `nil` and records nothing by design.

## What you do not configure

You do not pick Dynamic Island regions, toggle individual fields, or design layouts. Field
visibility is driven by which optional values you supply, and the layout, priority, and fallbacks
are fixed in `LiveStageUI`. The public API is exactly the seven functions shown above; there are no
others in V1.
