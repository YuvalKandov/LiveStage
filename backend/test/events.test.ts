import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makeTestApp, mobileAuth, journey } from "./helpers";

/** Starts a Journey session and returns its sessionId. */
async function startSession(app: ReturnType<typeof makeTestApp>["app"], key: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: mobileAuth(key),
    payload: { templateId: "trip-status", deepLinkParameters: { tripId: "123" }, payload: journey() },
  });
  return res.json().sessionId as string;
}

/** PATCHes a session forward and returns the new version. */
async function bumpVersion(app: ReturnType<typeof makeTestApp>["app"], key: string, sessionId: string): Promise<number> {
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/activities/${sessionId}`,
    headers: mobileAuth(key),
    payload: { clientMutationId: randomUUID(), payload: journey({ currentStep: "Boarding", progress: 0.6 }) },
  });
  return res.json().version as number;
}

function event(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: randomUUID(),
    sessionId: "REPLACE",
    installationId: "install-test-1",
    templateId: "trip-status",
    eventType: "activity_started",
    occurredAt: new Date().toISOString(),
    ...over,
  };
}

const upload = (app: ReturnType<typeof makeTestApp>["app"], key: string, events: unknown[]) =>
  app.inject({ method: "POST", url: "/v1/events/batch", headers: mobileAuth(key), payload: { events } });

test("batch ingest stores events scoped to the key's project", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);

  const res = await upload(app, mobileKey, [
    event({ sessionId, eventType: "activity_started" }),
    event({ sessionId, eventType: "activity_ended" }),
  ]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { accepted: 2, duplicates: 0, discarded: [] });

  const rows = db.prepare(`SELECT event_type, received_at FROM analytics_events WHERE session_id = ?`).all(sessionId) as {
    event_type: string;
    received_at: string;
  }[];
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.received_at), "server stamps received_at");
});

test("state_applied computes server-clock latency and bumps the daily ack counters", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);
  const version = await bumpVersion(app, mobileKey, sessionId); // v2, writes accepted_at (T1)

  const res = await upload(app, mobileKey, [
    event({ sessionId, eventType: "state_applied", version }),
  ]);
  assert.equal(res.json().accepted, 1);

  const lat = db
    .prepare(`SELECT latency_ms, accepted_at, ack_received_at FROM applied_latencies WHERE session_id = ? AND version = ?`)
    .get(sessionId, version) as { latency_ms: number; accepted_at: string; ack_received_at: string } | undefined;
  assert.ok(lat, "an applied_latencies row was written");
  assert.ok(lat!.latency_ms >= 0, "server-clock latency is non-negative (T2 >= T1)");
  // The number uses the version's accepted_at (T1) and the event's received_at (T2), both server.
  assert.equal(lat!.latency_ms, Date.parse(lat!.ack_received_at) - Date.parse(lat!.accepted_at));

  const daily = db
    .prepare(`SELECT updates_applied, ack_count, total_sync_latency_ms FROM daily_metrics WHERE template_id = 'trip-status'`)
    .get() as { updates_applied: number; ack_count: number; total_sync_latency_ms: number };
  assert.equal(daily.updates_applied, 1);
  assert.equal(daily.ack_count, 1);
  assert.equal(daily.total_sync_latency_ms, lat!.latency_ms);
});

test("re-uploading the same batch does not double-count (event_id dedupe)", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);
  const version = await bumpVersion(app, mobileKey, sessionId);
  const ack = event({ sessionId, eventType: "state_applied", version });

  const first = await upload(app, mobileKey, [ack]);
  assert.deepEqual(first.json(), { accepted: 1, duplicates: 0, discarded: [] });

  const second = await upload(app, mobileKey, [ack]);
  assert.equal(second.json().accepted, 0);
  assert.equal(second.json().duplicates, 1);

  const ackCount = (db.prepare(`SELECT ack_count FROM daily_metrics WHERE template_id = 'trip-status'`).get() as { ack_count: number }).ack_count;
  assert.equal(ackCount, 1, "the ack is not counted twice");
});

test("a new state_applied event with a fresh eventId but the same (session,version) stores the event but does not re-count the ack", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);
  const version = await bumpVersion(app, mobileKey, sessionId);

  // Two DISTINCT events (different eventIds) acking the SAME (session, version).
  await upload(app, mobileKey, [event({ sessionId, eventType: "state_applied", version })]);
  await upload(app, mobileKey, [event({ sessionId, eventType: "state_applied", version })]);

  // Both raw events are stored (different dedupe keys)...
  const rawAcks = (db.prepare(`SELECT COUNT(*) AS n FROM analytics_events WHERE session_id = ? AND event_type = 'state_applied'`).get(sessionId) as { n: number }).n;
  assert.equal(rawAcks, 2);

  // ...but the ack is distinct by (session, version): one latency row, counted once.
  const latRows = (db.prepare(`SELECT COUNT(*) AS n FROM applied_latencies WHERE session_id = ?`).get(sessionId) as { n: number }).n;
  assert.equal(latRows, 1);
  const daily = db
    .prepare(`SELECT updates_applied, ack_count FROM daily_metrics WHERE template_id = 'trip-status'`)
    .get() as { updates_applied: number; ack_count: number };
  assert.equal(daily.updates_applied, 1);
  assert.equal(daily.ack_count, 1);
});

test("a mixed batch reports accepted, duplicates, and discarded together", async () => {
  const { app, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);
  const reused = event({ sessionId, eventType: "activity_started" });

  await upload(app, mobileKey, [reused]); // first time -> accepted
  const res = await upload(app, mobileKey, [
    reused, // same eventId -> duplicate
    event({ sessionId, eventType: "activity_ended" }), // new -> accepted
    event({ sessionId: "ghost", eventType: "activity_opened" }), // unknown session -> discarded
  ]);
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(body.accepted, 1);
  assert.equal(body.duplicates, 1);
  assert.equal(body.discarded.length, 1);
  assert.equal(body.discarded[0].reason, "invalid_session");
});

test("an event for an unknown session is discarded, not stored", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const res = await upload(app, mobileKey, [event({ sessionId: "no-such-session" })]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().accepted, 0);
  assert.equal(res.json().discarded[0].reason, "invalid_session");
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM analytics_events`).get() as { n: number }).n;
  assert.equal(count, 0);
});

interface InteractionDaily {
  opens: number;
  expanded_action_taps: number;
  sessions_with_interaction: number;
}
const interactionDaily = (db: ReturnType<typeof makeTestApp>["db"]): InteractionDaily =>
  (db
    .prepare(`SELECT opens, expanded_action_taps, sessions_with_interaction FROM daily_metrics WHERE template_id = 'trip-status'`)
    .get() as InteractionDaily | undefined) ?? { opens: 0, expanded_action_taps: 0, sessions_with_interaction: 0 };

test("the first interaction of a session/day bumps opens and sessions_with_interaction", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);
  await upload(app, mobileKey, [event({ sessionId, eventType: "activity_opened" })]);
  const d = interactionDaily(db);
  assert.equal(d.opens, 1);
  assert.equal(d.sessions_with_interaction, 1);
});

test("a later interaction the same session/day counts the tap but not sessions_with_interaction again", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);
  await upload(app, mobileKey, [event({ sessionId, eventType: "activity_opened" })]);
  await upload(app, mobileKey, [event({ sessionId, eventType: "expanded_action_tapped", metadata: { source: "expanded_action" } })]);
  const d = interactionDaily(db);
  assert.equal(d.opens, 1);
  assert.equal(d.expanded_action_taps, 1);
  assert.equal(d.sessions_with_interaction, 1, "a session counts once per day no matter how many interactions");
});

test("two distinct sessions each contribute one to the day's sessions_with_interaction", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const s1 = await startSession(app, mobileKey);
  const s2 = await startSession(app, mobileKey);
  await upload(app, mobileKey, [event({ sessionId: s1, eventType: "activity_opened" })]);
  await upload(app, mobileKey, [event({ sessionId: s2, eventType: "activity_opened" })]);
  assert.equal(interactionDaily(db).sessions_with_interaction, 2);
});

test("re-uploading the same interaction event id inflates no counters", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);
  const ev = event({ sessionId, eventType: "activity_opened" });
  await upload(app, mobileKey, [ev]);
  await upload(app, mobileKey, [ev]); // same eventId

  const d = interactionDaily(db);
  assert.equal(d.opens, 1);
  assert.equal(d.sessions_with_interaction, 1);
  const raw = (db.prepare(`SELECT COUNT(*) AS n FROM analytics_events WHERE session_id = ? AND event_type = 'activity_opened'`).get(sessionId) as { n: number }).n;
  assert.equal(raw, 1, "the duplicate event id was not stored a second time");
});

test("expanded_action_tapped stores metadata.source and increments only its own counter", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);
  await upload(app, mobileKey, [event({ sessionId, eventType: "expanded_action_tapped", metadata: { source: "expanded_action" } })]);

  const row = db.prepare(`SELECT metadata_json FROM analytics_events WHERE session_id = ? AND event_type = 'expanded_action_tapped'`).get(sessionId) as { metadata_json: string };
  assert.deepEqual(JSON.parse(row.metadata_json), { source: "expanded_action" });
  const d = interactionDaily(db);
  assert.equal(d.expanded_action_taps, 1);
  assert.equal(d.opens, 0);
});

test("a malformed batch body is a 400 (distinct from per-event discards)", async () => {
  const { app, mobileKey } = makeTestApp();
  const res = await app.inject({ method: "POST", url: "/v1/events/batch", headers: mobileAuth(mobileKey), payload: { notEvents: [] } });
  assert.equal(res.statusCode, 400);
});

test("events/batch requires a mobile key", async () => {
  const { app } = makeTestApp();
  const res = await app.inject({ method: "POST", url: "/v1/events/batch", payload: { events: [] } });
  assert.equal(res.statusCode, 401);
});

test("a state_applied ack for version 1 (the start state) is stored but never counted", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey); // creates session_states version 1

  const res = await upload(app, mobileKey, [event({ sessionId, eventType: "state_applied", version: 1 })]);
  assert.equal(res.json().accepted, 1); // the raw event is kept for the timeline

  // ...but the start state is not an update: no latency row, no daily apply/ack bump (which would
  // let the per-day applySuccessRate exceed 100%, since version 1 is not an accepted_update).
  const latRows = (db.prepare(`SELECT COUNT(*) AS n FROM applied_latencies WHERE session_id = ?`).get(sessionId) as { n: number }).n;
  assert.equal(latRows, 0);
  const daily = db
    .prepare(`SELECT updates_applied, ack_count FROM daily_metrics WHERE template_id = 'trip-status'`)
    .get() as { updates_applied: number; ack_count: number } | undefined;
  assert.equal(daily?.updates_applied ?? 0, 0);
  assert.equal(daily?.ack_count ?? 0, 0);
});

test("metadata values must be short strings: nested or oversized values are discarded", async () => {
  const { app, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);

  const res = await upload(app, mobileKey, [
    event({ sessionId, eventType: "activity_opened", metadata: { source: { tripTitle: "Paris trip" } } }),
    event({ sessionId, eventType: "activity_opened", metadata: { source: "x".repeat(65) } }),
    event({ sessionId, eventType: "activity_opened", metadata: { source: "lock_screen" } }),
  ]);
  const body = res.json();
  assert.equal(body.accepted, 1);
  assert.equal(body.discarded.length, 2);
  assert.ok(body.discarded.every((d: { reason: string }) => d.reason === "invalid_metadata"));
});

test("a non-instant occurredAt is discarded, not stored", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);
  const res = await upload(app, mobileKey, [event({ sessionId, occurredAt: "yesterday at noon" })]);
  assert.equal(res.json().discarded[0].reason, "invalid_event");
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM analytics_events`).get() as { n: number }).n;
  assert.equal(count, 0);
});

test("sessions_started and sessions_ended are recorded as server-op daily counters", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);
  await app.inject({ method: "POST", url: `/v1/activities/${sessionId}/end`, headers: mobileAuth(mobileKey), payload: {} });
  // A repeat end must not double-count.
  await app.inject({ method: "POST", url: `/v1/activities/${sessionId}/end`, headers: mobileAuth(mobileKey), payload: {} });

  const daily = db
    .prepare(`SELECT sessions_started, sessions_ended FROM daily_metrics WHERE template_id = 'trip-status'`)
    .get() as { sessions_started: number; sessions_ended: number };
  assert.equal(daily.sessions_started, 1);
  assert.equal(daily.sessions_ended, 1);
});
