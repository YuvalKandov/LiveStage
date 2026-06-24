---
title: API reference
description: The seven public LiveStage functions and their supporting types.
---

The entire developer-facing surface of the SDK is seven functions on the `LiveStage` enum. There are
no others in V1. Every call routes through a single internal runtime actor.

```swift
public enum LiveStage {
    static func configure(apiKey: String, baseURL: URL)
    static func start(templateId: String,
                      deepLinkParameters: [String: String] = [:],
                      state: TemplatePayload) async throws -> LiveStageSession
    static func update(_ session: LiveStageSession, state: TemplatePayload) async throws
    static func end(_ session: LiveStageSession) async throws
    static func fetchConfiguration(templateId: String) async throws -> TemplateConfiguration
    static func status(_ session: LiveStageSession) async throws -> SessionStatus
    static func handleDeepLink(_ url: URL) async throws -> LiveStageRoute?
}
```

## Functions

### `configure(apiKey:baseURL:)`

```swift
static func configure(apiKey: String, baseURL: URL)
```

Must be called once, before any other API, for example at app launch. Sets the `mobile` key and the
backend base URL. Calling another function first throws `.notConfigured`.

### `start(templateId:deepLinkParameters:state:)`

```swift
@discardableResult
static func start(templateId: String,
                  deepLinkParameters: [String: String] = [:],
                  state: TemplatePayload) async throws -> LiveStageSession
```

Starts a Live Activity. It validates the state server-side, creates the session, requests the
ActivityKit activity, and begins polling. Must be called with the app in the **foreground** (an
ActivityKit requirement). If the local `Activity.request` fails, the just-created server session is
ended before the error is rethrown, so an orphan session is never left active.

- `templateId` - the id of a template authored in the portal.
- `deepLinkParameters` - parameters composed onto the template's deep-link base. The SDK validates
  and composes the final `deepLinkURL` before the activity starts.
- `state` - a `TemplatePayload` (`.journey`, `.countdown`, or `.progress`).
- Returns a `LiveStageSession` handle to keep for `update`, `end`, and `status`.

The SDK sends this to `POST /v1/activities` with the `mobile` key. The wire request and response:

```http
POST /v1/activities
Authorization: Bearer ls_mobile_...
Content-Type: application/json
```
```json
{
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
}
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

**Common failures.** A bad payload is rejected before the session is created:

```json
// 400 - progress out of range
{ "error": "validation", "message": "progress out of range (1.4); must be between 0 and 1.", "field": "progress" }
```
```json
// 400 - missing required field
{ "error": "validation", "message": "title is required.", "field": "title" }
```

### `update(_:state:)`

```swift
static func update(_ session: LiveStageSession, state: TemplatePayload) async throws
```

Applies an app-originated update. The backend accepts it as a new forward-only version, then the SDK
renders it immediately rather than waiting for the next poll. Each update carries one
`clientMutationId` reused across retries, so a lost response cannot create a duplicate version.

The SDK sends this to `PATCH /v1/activities/:sessionId`. The body is payload only; the server authors
the new `version` and `lastUpdatedAt`:

```http
PATCH /v1/activities/f1e2d3c4-5678-90ab-cdef-1234567890ab
Authorization: Bearer ls_mobile_...
Content-Type: application/json
```
```json
{
  "clientMutationId": "9a8b7c6d-0000-0000-0000-000000000001",
  "payload": {
    "type": "journey",
    "title": "Trip to Rome",
    "currentStep": "Boarding at gate B12",
    "progress": 0.6,
    "statusText": "Delayed 10 min"
  }
}
```
```json
{
  "version": 2,
  "lastUpdatedAt": "2026-06-24T12:40:01.000Z",
  "state": {
    "payload": { "type": "journey", "title": "Trip to Rome", "currentStep": "Boarding at gate B12", "progress": 0.6, "statusText": "Delayed 10 min" },
    "metadata": { "version": 2, "lastUpdatedAt": "2026-06-24T12:40:01.000Z" }
  }
}
```

**Common failures.** A repeated `clientMutationId` returns the original version rather than creating a
new one. An update after `end` is rejected:

```json
// 409 - the activity has already ended
{ "error": "already_ended", "message": "Session f1e2d3c4-5678-90ab-cdef-1234567890ab has ended; updates are rejected." }
```
```json
// 404 - unknown session id
{ "error": "session_not_found", "message": "No activity session f1e2d3c4-5678-90ab-cdef-1234567890ab." }
```

### `end(_:)`

```swift
static func end(_ session: LiveStageSession) async throws
```

Ends the activity and stops its polling. Idempotent server-side. Updates after `end` are rejected
with `.alreadyEnded`.

The SDK sends this to `POST /v1/activities/:sessionId/end`. A second call returns the same result with
`alreadyEnded: true` rather than erroring:

```http
POST /v1/activities/f1e2d3c4-5678-90ab-cdef-1234567890ab/end
Authorization: Bearer ls_mobile_...
Content-Type: application/json
```
```json
{ "reason": "done" }
```
```json
{ "status": "ended", "endedAt": "2026-06-24T12:45:00.000Z", "alreadyEnded": false }
```

### `fetchConfiguration(templateId:)`

```swift
static func fetchConfiguration(templateId: String) async throws -> TemplateConfiguration
```

Fetches a template's static configuration (type, branding, labels, deep-link base, stale window).
Cached after the first call; serves the last known value from a durable cache when offline.

The SDK sends this to `GET /v1/templates/:templateId` with the `mobile` key:

```http
GET /v1/templates/trip-status
Authorization: Bearer ls_mobile_...
```
```json
{
  "templateId": "trip-status",
  "templateType": "journey",
  "displayName": "Trip status",
  "icon": "airplane",
  "accentStyle": "blue",
  "deepLinkBase": "triptogether://trip",
  "labels": { "nextStepLabel": "Next", "targetLabel": "Arrives", "zeroStateLabel": null },
  "staleAfterSeconds": 900
}
```

### `status(_:)`

```swift
static func status(_ session: LiveStageSession) async throws -> SessionStatus
```

Fetches the current server status (`active` or `ended`), the version, and the last-updated time. The
server returns only `active` or `ended`; `stale` and `dismissed` are local ActivityKit realities,
never server-sent. Serves a cached value when offline.

The SDK sends this to `GET /v1/activities/:sessionId`. The response carries the full current state, not
just the status:

```http
GET /v1/activities/f1e2d3c4-5678-90ab-cdef-1234567890ab
Authorization: Bearer ls_mobile_...
```
```json
{
  "status": "active",
  "version": 2,
  "lastUpdatedAt": "2026-06-24T12:40:01.000Z",
  "staleAfterSeconds": 900,
  "state": {
    "payload": { "type": "journey", "title": "Trip to Rome", "currentStep": "Boarding at gate B12", "...": "..." },
    "metadata": { "version": 2, "lastUpdatedAt": "2026-06-24T12:40:01.000Z" }
  }
}
```

### `handleDeepLink(_:)`

```swift
@discardableResult
static func handleDeepLink(_ url: URL) async throws -> LiveStageRoute?
```

Call from the host app's `.onOpenURL`. Records `activity_opened` for a primary tap or
`expanded_action_tapped` for a tap on the explicit Link inside the expanded Dynamic Island, based on
the URL's `source` query item, then returns the route with `source` stripped. Returns `nil` for a URL
that does not belong to a known LiveStage activity; treat `nil` as a normal app URL.

## Analytics event upload (automatic)

You never call this endpoint yourself. As activities run, the SDK records the locked event set and
flushes them in batches to `POST /v1/events/batch` with the `mobile` key. It is documented here so you
can see what leaves the device. Events carry identifiers and event types only, never user content or
state fields - `metadata` holds non-personal qualifiers (`source`, `reason`) and nothing else.

```http
POST /v1/events/batch
Authorization: Bearer ls_mobile_...
Content-Type: application/json
```
```json
{
  "events": [
    {
      "eventId": "9f4c1e2a-8b7d-4c3e-a1f0-6d2b9e5c7a14",
      "sessionId": "f1e2d3c4-5678-90ab-cdef-1234567890ab",
      "installationId": "a7e2c9b0-1f44-4d8e-9c21-0b3a6f8d2e55",
      "templateId": "trip-status",
      "eventType": "state_applied",
      "version": 2,
      "occurredAt": "2026-06-24T12:40:02.000Z",
      "metadata": null
    },
    {
      "eventId": "1b0d7f33-2c9a-4e61-b5d8-77a4c0e91f2b",
      "...": "...",
      "eventType": "expanded_action_tapped",
      "metadata": { "source": "expanded_action" }
    }
  ]
}
```

The response is per-event and idempotent: a re-uploaded `eventId` counts as a `duplicate`, never
double-counted, and individually unusable events come back under `discarded` while the batch still
returns 200.

```json
{
  "accepted": 1,
  "duplicates": 1,
  "discarded": [
    { "eventId": "c3a4...", "reason": "invalid_session" }
  ]
}
```

`version` is present only on `state_applied` (it drives the acknowledged-sync-latency metric); it is
omitted on every other event type. Discard `reason` is one of `invalid_event`, `invalid_event_type`,
`invalid_session`, or `invalid_metadata`.

## Supporting types

### `LiveStageSession`

```swift
public struct LiveStageSession: Codable, Hashable, Sendable {
    public let sessionId: String
    public let templateId: String
}
```

The handle returned by `start` and passed back to `update`, `end`, and `status`. The SDK maps
`sessionId` to the ActivityKit `Activity.id` internally.

### `SessionStatus`

```swift
public struct SessionStatus: Codable, Hashable, Sendable {
    public let status: LifecycleStatus
    public let version: Int
    public let lastUpdatedAt: Date
}
```

The result of `status`.

### `LifecycleStatus`

```swift
public enum LifecycleStatus: String, Codable, Hashable, Sendable {
    case active
    case ended
    case stale       // local-only, never server-sent
    case dismissed   // local-only, never server-sent
}
```

A server status fetched through `status` is always `active` or `ended`. The `stale` and `dismissed`
cases describe local on-device realities the SDK may observe; the server never sends them.

### `LiveStageRoute`

```swift
public struct LiveStageRoute: Codable, Hashable, Sendable {
    public let sessionId: String
    public let parameters: [String: String]   // your params, source stripped
    public let source: InteractionSource
}
```

Returned by `handleDeepLink` after a deep link is tapped.

### `InteractionSource`

```swift
public enum InteractionSource: String, Codable, Hashable, Sendable {
    case primary          // tap that opens the main activity
    case expandedAction   // tap on a specific Link in the expanded Dynamic Island
}
```

These are distinct intentional actions, never a long-press or expansion count.

## Known-good payloads

These are the minimal valid wire payloads for each template, the same bodies the backend's own tests
use. Copy one as a starting point for `start` or `update`. Every field not shown is optional. See
[Templates](/LiveStage/templates/) for the full field reference and per-surface rendering.

```json
// journey - title and currentStep are required
{
  "type": "journey",
  "title": "Trip to Rome",
  "currentStep": "Heading to the airport",
  "nextStep": "Flight AZ809",
  "progress": 0.35,
  "statusText": "On time"
}
```
```json
// countdown - title and targetDate (a strict ISO-8601 instant) are required
{
  "type": "countdown",
  "title": "Flight to Rome",
  "subtitle": "Gate B12",
  "targetDate": "2026-06-24T18:42:00Z",
  "statusText": "On time",
  "location": "Terminal 3"
}
```
```json
// progress - title and progress (0 to 1) are required
{
  "type": "progress",
  "title": "Preparing your order",
  "currentStage": "Packing",
  "progress": 0.72,
  "detailText": "3 items left"
}
```

## Errors

Every call throws `LiveStageError`, which conforms to `LocalizedError`. See the
[Getting started error table](/LiveStage/getting-started/#error-handling) for each case, when it
happens, and its message.
