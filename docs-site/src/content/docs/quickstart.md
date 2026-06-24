---
title: Quickstart
description: Render your first LiveStage Live Activity in about five minutes.
---

This is the shortest path from a running backend to a Live Activity on screen. It assumes you have
the LiveStage repository and can run the backend locally. For a full integration into your own app,
read [Getting started](/LiveStage/getting-started/).

:::note[Prerequisites]
- iOS 16.2 or later. The Lock Screen renders on any simulator; the Dynamic Island needs a **Pro**
  simulator or device.
- A running LiveStage backend with a seeded `mobile` key and at least one template.
:::

## 1. Run the backend and seed it

```sh
cd backend
npm install
npm run seed     # creates the demo project, keys, and templates
npm run dev      # serves on http://localhost:8787
```

`npm run seed` prints a `mobileKey` and writes it to `backend/.seeded-keys.json`. The seeded
templates include `trip-status` (journey), `flight-countdown` (countdown), and `order-progress`
(progress).

## 2. Configure the SDK once at launch

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

## 3. Start an activity

```swift
import LiveStage
import LiveStageModels

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
```

That call validates your state server-side, creates the session, requests the ActivityKit activity,
and starts polling. The Lock Screen card appears immediately; on a Pro simulator the Dynamic Island
does too.

## 4. Update and end it

```swift
// Render new state right away (the SDK does not wait for the next poll).
try await LiveStage.update(session, state: .journey(JourneyState(
    title: "Trip to Rome",
    currentStep: "Boarding at gate B12",
    progress: 0.6,
    statusText: "Delayed 10 min"
)))

// End it when the activity is done.
try await LiveStage.end(session)
```

You can also drive updates from the **portal**: open the Sessions tab, edit the session's state, and
the running app applies the new server version within one poll interval (8s default).

## Prove the loop with curl (no Xcode)

You can exercise the same backend the SDK calls, straight from a terminal. Start a session with your
seeded `mobile` key:

```sh
curl -s http://localhost:8787/v1/activities \
  -H "Authorization: Bearer ls_mobile_..." \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "trip-status",
    "deepLinkParameters": { "tripId": "123" },
    "payload": {
      "type": "journey",
      "title": "Trip to Rome",
      "currentStep": "Heading to the airport",
      "nextStep": "Flight AZ809",
      "progress": 0.35,
      "statusText": "On time"
    }
  }'
```

```json
{
  "sessionId": "f1e2d3c4-5678-90ab-cdef-1234567890ab",
  "version": 1,
  "deepLinkURL": "triptogether://trip?tripId=123",
  "staleAfterSeconds": 900,
  "lastUpdatedAt": "2026-06-24T12:34:56.000Z"
}
```

Then read the aggregated metrics with your `service` key. The Insights API requires a `service` key;
a `mobile` key is rejected with `403`.

```sh
curl -s "http://localhost:8787/v1/insights/summary?from=2026-06-01T00:00:00Z&to=2026-07-01T00:00:00Z" \
  -H "Authorization: Bearer ls_service_..."
```

```json
{
  "projectId": "demo-project",
  "range": { "from": "2026-06-01T00:00:00Z", "to": "2026-07-01T00:00:00Z", "evaluationTime": "2026-06-24T12:35:10.000Z", "templateId": null },
  "heroes": {
    "applySuccessRate": { "rate": 0.95, "numerator": 19, "denominator": 20 },
    "acknowledgedSyncLatencyMs": { "averageMs": 420, "medianMs": 380, "count": 19 },
    "interactionRate": { "rate": 0.4, "numerator": 4, "denominator": 10 },
    "updateRejectionRate": { "rate": 0.05, "numerator": 1, "denominator": 20 }
  },
  "secondary": { "lateApplicationRate": { "rate": 0.1, "numerator": 2, "denominator": 20 } },
  "totals": { "sessionsStarted": 10, "sessionsEnded": 6, "opens": 5, "expandedActionTaps": 1, "uniqueInstallations": 3, "updateAttempts": 21, "acceptedUpdates": 20, "rejectedUpdates": 1, "syncFailures": 0, "updatesPerSession": 2.0 }
}
```

Each rate carries its own numerator and denominator, so every headline number is auditable from the
raw response. See the [API reference](/LiveStage/api-reference/) for the full request and response of
each mutating call.

## What just happened

You ran the full loop: the server holds authoritative, versioned state; the SDK renders it natively
and reports analytics events on its own; and the backend aggregates those events for the Insights
API. The only analytics wiring you ever add yourself is `handleDeepLink`, covered next.

:::tip[Next steps]
- [Getting started](/LiveStage/getting-started/) walks the full integration, including the Widget
  Extension and deep links.
- [Templates](/LiveStage/templates/) lists every field for Journey, Countdown, and Progress.
- [API reference](/LiveStage/api-reference/) documents all seven functions.
:::
