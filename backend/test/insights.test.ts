import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { makeTestApp, journey, PROJECT_ID } from "./helpers";

type App = ReturnType<typeof makeTestApp>["app"];
const auth = (key: string) => ({ authorization: `Bearer ${key}` });
const iso = () => new Date().toISOString();

const summary = (app: App, key: string, query = "") =>
  app.inject({ method: "GET", url: `/v1/insights/summary${query}`, headers: auth(key) });

async function startSession(app: App, key: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: auth(key),
    payload: { templateId: "trip-status", deepLinkParameters: { tripId: "1" }, payload: journey() },
  });
  return res.json().sessionId as string;
}

const patch = (app: App, key: string, sessionId: string, payload: Record<string, unknown>) =>
  app.inject({
    method: "PATCH",
    url: `/v1/activities/${sessionId}`,
    headers: auth(key),
    payload: { clientMutationId: randomUUID(), payload },
  });

const uploadAck = (app: App, key: string, sessionId: string, version: number) =>
  app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: auth(key),
    payload: {
      events: [{ eventId: randomUUID(), sessionId, installationId: "i-1", templateId: "trip-status", eventType: "state_applied", version, occurredAt: iso() }],
    },
  });

const uploadOpen = (app: App, key: string, sessionId: string) =>
  app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: auth(key),
    payload: {
      events: [{ eventId: randomUUID(), sessionId, installationId: "i-1", templateId: "trip-status", eventType: "activity_opened", occurredAt: iso() }],
    },
  });

// --- Direct raw-row crafting, to assert cohort/median/late math deterministically (timestamps the
//     HTTP path can't control). These mirror exactly what the ingest/update paths write. ---
function craftSession(db: Database, sessionId: string, startedAt: string, projectId = PROJECT_ID): void {
  db.prepare(
    `INSERT INTO activity_sessions (id, project_id, template_id, type, deep_link_url, status, version, last_updated_at, started_at, ended_at, attributes_json)
     VALUES (?, ?, 'trip-status', 'journey', 'triptogether://trip', 'active', 1, ?, ?, NULL, '{}')`,
  ).run(sessionId, projectId, startedAt, startedAt);
}

const batch = (app: App, key: string, events: unknown[]) =>
  app.inject({ method: "POST", url: "/v1/events/batch", headers: auth(key), payload: { events } });
const timeline = (app: App, key: string, sessionId: string) =>
  app.inject({ method: "GET", url: `/v1/insights/sessions/${sessionId}`, headers: auth(key) });
const ev = (sessionId: string, eventType: string, occurredAt: string, extra: Record<string, unknown> = {}) => ({
  eventId: randomUUID(),
  sessionId,
  installationId: "i",
  templateId: "trip-status",
  eventType,
  occurredAt,
  ...extra,
});

const templateSummary = (app: App, key: string, templateId: string, query = "") =>
  app.inject({ method: "GET", url: `/v1/insights/templates/${templateId}${query}`, headers: auth(key) });
const timeseries = (app: App, key: string, query: string) =>
  app.inject({ method: "GET", url: `/v1/insights/timeseries${query}`, headers: auth(key) });

// Craft a daily_metrics row directly, to drive the per-day chart endpoint independently of raw data.
function craftDaily(db: Database, date: string, cols: Partial<Record<string, number>> = {}, templateId = "trip-status"): void {
  db.prepare(
    `INSERT INTO daily_metrics
       (project_id, template_id, date, sessions_started, sessions_with_interaction,
        rejected_updates, update_attempts, updates_applied, accepted_updates, total_sync_latency_ms, ack_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    PROJECT_ID, templateId, date,
    cols.sessions_started ?? 0, cols.sessions_with_interaction ?? 0,
    cols.rejected_updates ?? 0, cols.update_attempts ?? 0, cols.updates_applied ?? 0,
    cols.accepted_updates ?? 0, cols.total_sync_latency_ms ?? 0, cols.ack_count ?? 0,
  );
}
function craftAccepted(db: Database, sessionId: string, version: number, acceptedAt: string): void {
  db.prepare(
    `INSERT INTO session_states (session_id, version, mutation_id, payload_json, accepted_at, created_at)
     VALUES (?, ?, ?, '{}', ?, ?)`,
  ).run(sessionId, version, randomUUID(), acceptedAt, acceptedAt);
}
function craftAck(db: Database, sessionId: string, version: number, acceptedAt: string, ackReceivedAt: string): void {
  const latency = Date.parse(ackReceivedAt) - Date.parse(acceptedAt);
  db.prepare(
    `INSERT INTO applied_latencies (project_id, template_id, session_id, version, accepted_at, ack_received_at, latency_ms, date)
     VALUES (?, 'trip-status', ?, ?, ?, ?, ?, ?)`,
  ).run(PROJECT_ID, sessionId, version, acceptedAt, ackReceivedAt, latency, acceptedAt.slice(0, 10));
}
function craftInteraction(db: Database, sessionId: string): void {
  db.prepare(
    `INSERT INTO analytics_events (event_id, project_id, session_id, installation_id, template_id, event_type, version, occurred_at, received_at, metadata_json)
     VALUES (?, ?, ?, 'i', 'trip-status', 'activity_opened', NULL, ?, ?, NULL)`,
  ).run(randomUUID(), PROJECT_ID, sessionId, iso(), iso());
}

// ---------------------------------------------------------------------------------------------------
// Auth boundaries
// ---------------------------------------------------------------------------------------------------

test("summary requires a service key: service 200, mobile 403, missing 401", async () => {
  const { app, mobileKey, serviceKey } = makeTestApp();
  assert.equal((await summary(app, serviceKey)).statusCode, 200);
  assert.equal((await summary(app, mobileKey)).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/v1/insights/summary" })).statusCode, 401);
});

test("a service key cannot call an activity-mutation route", async () => {
  const { app, serviceKey } = makeTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: auth(serviceKey),
    payload: { templateId: "trip-status", deepLinkParameters: {}, payload: journey() },
  });
  assert.equal(res.statusCode, 403);
});

// ---------------------------------------------------------------------------------------------------
// Hero metrics via a real flow
// ---------------------------------------------------------------------------------------------------

test("summary computes apply-success (<=100%), interaction, and rejection from a real flow, with raw num/denom", async () => {
  const { app, mobileKey, serviceKey } = makeTestApp();
  const a = await startSession(app, mobileKey);
  await patch(app, mobileKey, a, journey({ progress: 0.5 })); // v2 accept
  await patch(app, mobileKey, a, journey({ progress: 0.7 })); // v3 accept
  await patch(app, mobileKey, a, journey({ progress: 1.4 })); // reject (out of range)
  await uploadAck(app, mobileKey, a, 2); // ack v2
  await uploadAck(app, mobileKey, a, 2); // duplicate ack (new eventId, same version) — must NOT inflate
  const b = await startSession(app, mobileKey); // started, no updates/interaction
  await uploadOpen(app, mobileKey, a); // A has an interaction

  const body = (await summary(app, serviceKey)).json();

  // apply-success: accepted post-start versions v2,v3 -> denom 2; acked v2 -> numer 1; <= 100%.
  assert.deepEqual(body.heroes.applySuccessRate, { rate: 0.5, numerator: 1, denominator: 2 });
  // interaction: sessions started A,B -> denom 2; with interaction A -> numer 1.
  assert.deepEqual(body.heroes.interactionRate, { rate: 0.5, numerator: 1, denominator: 2 });
  // rejection: accepted mutations 2 (v2,v3) + rejected 1 -> 1/3.
  assert.deepEqual(body.heroes.updateRejectionRate, { rate: 1 / 3, numerator: 1, denominator: 3 });
  assert.equal(body.totals.syncFailures, 0);
  assert.equal(body.totals.opens, 1);
});

test("acknowledged latency average and median come from the raw accepted-version cohort", async () => {
  const { app, db, serviceKey } = makeTestApp();
  const sid = "s-lat";
  craftSession(db, sid, "2022-06-01T00:00:00.000Z");
  craftAccepted(db, sid, 2, "2022-06-01T00:00:01.000Z");
  craftAck(db, sid, 2, "2022-06-01T00:00:01.000Z", "2022-06-01T00:00:01.010Z"); // 10ms
  craftAccepted(db, sid, 3, "2022-06-01T00:00:02.000Z");
  craftAck(db, sid, 3, "2022-06-01T00:00:02.000Z", "2022-06-01T00:00:02.020Z"); // 20ms
  craftAccepted(db, sid, 4, "2022-06-01T00:00:03.000Z");
  craftAck(db, sid, 4, "2022-06-01T00:00:03.000Z", "2022-06-01T00:00:03.030Z"); // 30ms
  craftAccepted(db, sid, 5, "2022-06-01T00:00:04.000Z"); // accepted, no ack
  // Accepted+acked OUTSIDE the range -> must be excluded from the cohort.
  craftAccepted(db, sid, 6, "2019-01-01T00:00:00.000Z");
  craftAck(db, sid, 6, "2019-01-01T00:00:00.000Z", "2019-01-01T00:00:00.999Z");

  const body = (await summary(app, serviceKey, "?from=2022-01-01T00:00:00.000Z&to=2023-01-01T00:00:00.000Z")).json();

  // apply cohort: v2,v3,v4,v5 in range -> denom 4; acked v2,v3,v4 -> numer 3 (v6 excluded).
  assert.deepEqual(body.heroes.applySuccessRate, { rate: 0.75, numerator: 3, denominator: 4 });
  // latency cohort: 10,20,30 -> avg 20, median 20, count 3 (v6's 999ms excluded).
  assert.deepEqual(body.heroes.acknowledgedSyncLatencyMs, { averageMs: 20, medianMs: 20, count: 3 });
});

test("interaction rate excludes sessions started before the range from the numerator", async () => {
  const { app, db, serviceKey } = makeTestApp();
  craftSession(db, "old", "2020-01-01T00:00:00.000Z");
  craftInteraction(db, "old"); // pre-range session WITH an interaction
  craftSession(db, "new", "2022-06-01T00:00:00.000Z"); // in-range session, no interaction

  const body = (await summary(app, serviceKey, "?from=2021-01-01T00:00:00.000Z&to=2023-01-01T00:00:00.000Z")).json();
  // Only 'new' is in the cohort; 'old' and its interaction are excluded entirely.
  assert.deepEqual(body.heroes.interactionRate, { rate: 0, numerator: 0, denominator: 1 });
});

test("lateApplicationRate counts only deadline-eligible post-start updates", async () => {
  const { app, db, serviceKey } = makeTestApp(); // trip-status staleAfterSeconds = 900
  const sid = "late";
  craftSession(db, sid, "2020-01-01T00:00:00.000Z");
  craftAccepted(db, sid, 2, "2020-01-01T00:00:00.000Z"); // no ack -> eligible + late
  craftAccepted(db, sid, 3, "2020-01-01T00:00:00.000Z");
  craftAck(db, sid, 3, "2020-01-01T00:00:00.000Z", "2020-01-01T00:33:20.000Z"); // +2000s (> 900) -> late
  craftAccepted(db, sid, 4, "2020-01-01T00:00:00.000Z");
  craftAck(db, sid, 4, "2020-01-01T00:00:00.000Z", "2020-01-01T00:01:40.000Z"); // +100s (< 900) -> on time
  craftAccepted(db, sid, 5, iso()); // accepted now -> deadline in the future -> not eligible

  const body = (await summary(app, serviceKey, "?from=2019-01-01T00:00:00.000Z")).json();
  // eligible: v2,v3,v4 (deadlines passed); v5 excluded. late: v2 (no ack) + v3 (late ack) = 2.
  assert.deepEqual(body.secondary.lateApplicationRate, { rate: 2 / 3, numerator: 2, denominator: 3 });
});

test("an invalid range date is a 400", async () => {
  const { app, serviceKey } = makeTestApp();
  assert.equal((await summary(app, serviceKey, "?from=not-a-date")).statusCode, 400);
});

// ---------------------------------------------------------------------------------------------------
// Session timeline (GET /v1/insights/sessions/:sessionId)
// ---------------------------------------------------------------------------------------------------

const ALLOWED_EVENT_KEYS = new Set(["eventId", "eventType", "templateId", "version", "metadata", "occurredAt", "receivedAt", "latencyMs"]);

test("session timeline orders by occurredAt, carries both timestamps, and stays content-free", async () => {
  const { app, mobileKey, serviceKey } = makeTestApp();
  const sid = await startSession(app, mobileKey);
  await patch(app, mobileKey, sid, journey({ progress: 0.6 })); // v2 -> session_states accepted_at

  // Upload out of order to prove the response sorts by occurredAt.
  await batch(app, mobileKey, [
    ev(sid, "activity_ended", "2026-06-01T00:00:30.000Z"),
    ev(sid, "activity_started", "2026-06-01T00:00:00.000Z"),
    ev(sid, "state_applied", "2026-06-01T00:00:10.000Z", { version: 2 }),
    ev(sid, "expanded_action_tapped", "2026-06-01T00:00:20.000Z", { metadata: { source: "expanded_action" } }),
  ]);

  const res = await timeline(app, serviceKey, sid);
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.deepEqual(
    body.events.map((e: { eventType: string }) => e.eventType),
    ["activity_started", "state_applied", "expanded_action_tapped", "activity_ended"],
  );
  for (const e of body.events) {
    assert.ok(e.occurredAt && e.receivedAt, "every event carries device occurredAt and server receivedAt");
    for (const k of Object.keys(e)) assert.ok(ALLOWED_EVENT_KEYS.has(k), `unexpected (possibly content) field: ${k}`);
  }
  const tap = body.events.find((e: { eventType: string }) => e.eventType === "expanded_action_tapped");
  assert.deepEqual(tap.metadata, { source: "expanded_action" });
});

test("state_applied carries latencyMs joined by (session, version)", async () => {
  const { app, mobileKey, serviceKey } = makeTestApp();
  const sid = await startSession(app, mobileKey);
  await patch(app, mobileKey, sid, journey({ progress: 0.6 })); // v2
  await uploadAck(app, mobileKey, sid, 2);

  const body = (await timeline(app, serviceKey, sid)).json();
  const ack = body.events.find((e: { eventType: string }) => e.eventType === "state_applied");
  assert.equal(ack.version, 2);
  assert.equal(typeof ack.latencyMs, "number");
  assert.ok(ack.latencyMs >= 0);
});

test("duplicate state_applied raw events show at most one latency value per version", async () => {
  const { app, mobileKey, serviceKey } = makeTestApp();
  const sid = await startSession(app, mobileKey);
  await patch(app, mobileKey, sid, journey({ progress: 0.6 })); // v2
  await uploadAck(app, mobileKey, sid, 2);
  await uploadAck(app, mobileKey, sid, 2); // distinct eventId, same (session, version)

  const body = (await timeline(app, serviceKey, sid)).json();
  const acks = body.events.filter((e: { eventType: string; version: number }) => e.eventType === "state_applied" && e.version === 2);
  assert.equal(acks.length, 2, "both raw acks appear in the timeline");
  const distinctLatencies = new Set(acks.map((a: { latencyMs: number }) => a.latencyMs));
  assert.equal(distinctLatencies.size, 1, "at most one latency value per version");
});

test("timeline metadata is restricted to the allowed keys even if a raw row carries more", async () => {
  const { app, db, mobileKey, serviceKey } = makeTestApp();
  const sid = await startSession(app, mobileKey);
  // Craft a raw row carrying a content key, bypassing ingest validation, to prove the response filters it.
  db.prepare(
    `INSERT INTO analytics_events (event_id, project_id, session_id, installation_id, template_id, event_type, version, occurred_at, received_at, metadata_json)
     VALUES (?, ?, ?, 'i', 'trip-status', 'expanded_action_tapped', NULL, ?, ?, ?)`,
  ).run(randomUUID(), PROJECT_ID, sid, iso(), iso(), JSON.stringify({ source: "expanded_action", title: "secret trip" }));

  const body = (await timeline(app, serviceKey, sid)).json();
  const tap = body.events.find((e: { eventType: string }) => e.eventType === "expanded_action_tapped");
  assert.deepEqual(tap.metadata, { source: "expanded_action" }, "content keys are stripped from the response");
});

test("session timeline: service allowed, mobile rejected, unknown and foreign sessions 404", async () => {
  const { app, db, mobileKey, serviceKey } = makeTestApp();
  const sid = await startSession(app, mobileKey);
  assert.equal((await timeline(app, serviceKey, sid)).statusCode, 200);
  assert.equal((await timeline(app, mobileKey, sid)).statusCode, 403);
  assert.equal((await timeline(app, serviceKey, "no-such-session")).statusCode, 404);

  // A session in another project must not be visible to this project's service key.
  db.prepare(`INSERT INTO projects (id, name, created_at) VALUES ('other-project', 'Other', ?)`).run(iso());
  craftSession(db, "foreign-session", iso(), "other-project");
  assert.equal((await timeline(app, serviceKey, "foreign-session")).statusCode, 404);
});

// ---------------------------------------------------------------------------------------------------
// Per-template summary (GET /v1/insights/templates/:templateId) — reuses computeSummary (CP4)
// ---------------------------------------------------------------------------------------------------

test("template summary: service allowed, mobile rejected, unknown and foreign templates 404", async () => {
  const { app, db, mobileKey, serviceKey } = makeTestApp();
  assert.equal((await templateSummary(app, serviceKey, "trip-status")).statusCode, 200);
  assert.equal((await templateSummary(app, mobileKey, "trip-status")).statusCode, 403);
  assert.equal((await templateSummary(app, serviceKey, "nonexistent")).statusCode, 404);

  // A template that exists only in another project must not be visible here.
  db.prepare(`INSERT INTO projects (id, name, created_at) VALUES ('other-project', 'Other', ?)`).run(iso());
  db.prepare(
    `INSERT INTO templates (id, project_id, template_id, type, display_name, icon, accent, deep_link_base, labels_json, zero_state_label, stale_after_seconds, created_at, updated_at)
     VALUES ('x', 'other-project', 'secret-template', 'journey', 'X', 'airplane', 'blue', 'x://y', '{}', NULL, 900, ?, ?)`,
  ).run(iso(), iso());
  assert.equal((await templateSummary(app, serviceKey, "secret-template")).statusCode, 404);
});

test("template summary is scoped to the one template and reuses cohort-aligned hero math", async () => {
  const { app, db, serviceKey } = makeTestApp();
  // One trip-status session with a v2 accept + ack; one order-progress session with a v2 accept, no ack.
  craftSession(db, "s-trip", "2026-06-10T00:00:00.000Z");
  craftAccepted(db, "s-trip", 2, "2026-06-10T00:00:01.000Z");
  craftAck(db, "s-trip", 2, "2026-06-10T00:00:01.000Z", "2026-06-10T00:00:01.030Z");
  db.prepare(
    `INSERT INTO activity_sessions (id, project_id, template_id, type, deep_link_url, status, version, last_updated_at, started_at, ended_at, attributes_json)
     VALUES ('s-order', ?, 'order-progress', 'progress', 'x://y', 'active', 1, ?, ?, NULL, '{}')`,
  ).run(PROJECT_ID, "2026-06-10T00:00:00.000Z", "2026-06-10T00:00:00.000Z");
  craftAccepted(db, "s-order", 2, "2026-06-10T00:00:01.000Z");

  const body = (await templateSummary(app, serviceKey, "trip-status", "?from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z")).json();
  // Only trip-status' accepted version is in scope: denom 1, acked 1 -> 1.0 (order-progress excluded).
  assert.deepEqual(body.heroes.applySuccessRate, { rate: 1, numerator: 1, denominator: 1 });
  assert.equal(body.range.templateId, "trip-status");
});

test("range heroes ignore inflated daily_metrics (no daily distinct summed into a hero)", async () => {
  const { app, db, serviceKey } = makeTestApp();
  // Raw truth: one trip-status session started in range, with one interaction.
  craftSession(db, "s-raw", "2026-06-10T00:00:00.000Z");
  craftInteraction(db, "s-raw");
  // Inflated daily aggregate for the same template/day — must NOT feed the range hero.
  craftDaily(db, "2026-06-10", { sessions_started: 99, sessions_with_interaction: 99 });

  const body = (await templateSummary(app, serviceKey, "trip-status", "?from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z")).json();
  // From raw: 1 session, 1 with interaction -> 1/1, never 99/99 or a summed 100.
  assert.deepEqual(body.heroes.interactionRate, { rate: 1, numerator: 1, denominator: 1 });
  // The daily aggregate is still available for the per-day chart.
  const ts = (await timeseries(app, serviceKey, "?metric=sessionsWithInteraction&from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z")).json();
  assert.ok(ts.series.some((r: { date: string; value: number }) => r.date === "2026-06-10" && r.value === 99));
});

// ---------------------------------------------------------------------------------------------------
// Timeseries (GET /v1/insights/timeseries) — per-day rows from daily_metrics only
// ---------------------------------------------------------------------------------------------------

test("timeseries: service allowed, mobile rejected, unknown metric 400, non-day interval 400", async () => {
  const { app, mobileKey, serviceKey } = makeTestApp();
  assert.equal((await timeseries(app, serviceKey, "?metric=opens")).statusCode, 200);
  assert.equal((await timeseries(app, mobileKey, "?metric=opens")).statusCode, 403);
  assert.equal((await timeseries(app, serviceKey, "?metric=banana")).statusCode, 400);
  assert.equal((await timeseries(app, serviceKey, "?metric=opens&interval=hour")).statusCode, 400);
});

test("timeseries rate rows expose numerator/denominator and null on a zero denominator", async () => {
  const { app, db, serviceKey } = makeTestApp();
  craftDaily(db, "2026-07-01", { sessions_started: 5, rejected_updates: 0, update_attempts: 0 }); // zero denom
  craftDaily(db, "2026-07-02", { rejected_updates: 1, update_attempts: 4 }); // 0.25

  const body = (await timeseries(app, serviceKey, "?metric=updateRejectionRate&from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z")).json();
  assert.equal(body.kind, "rate");
  const d1 = body.series.find((r: { date: string }) => r.date === "2026-07-01");
  const d2 = body.series.find((r: { date: string }) => r.date === "2026-07-02");
  assert.deepEqual(d1, { date: "2026-07-01", value: null, numerator: 0, denominator: 0 });
  assert.deepEqual(d2, { date: "2026-07-02", value: 0.25, numerator: 1, denominator: 4 });
});

test("timeseries count rows carry the raw additive value per day", async () => {
  const { app, db, serviceKey } = makeTestApp();
  craftDaily(db, "2026-07-01", { sessions_started: 3 });
  craftDaily(db, "2026-07-02", { sessions_started: 7 });
  const body = (await timeseries(app, serviceKey, "?metric=sessionsStarted&from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z")).json();
  assert.equal(body.kind, "count");
  assert.deepEqual(body.series, [
    { date: "2026-07-01", value: 3 },
    { date: "2026-07-02", value: 7 },
  ]);
});

test("timeseries averageLatencyMs is total_sync_latency_ms / ack_count per day", async () => {
  const { app, db, serviceKey } = makeTestApp();
  craftDaily(db, "2026-07-01", { total_sync_latency_ms: 90, ack_count: 3 }); // avg 30
  const body = (await timeseries(app, serviceKey, "?metric=averageLatencyMs&from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z")).json();
  assert.deepEqual(body.series[0], { date: "2026-07-01", value: 30, numerator: 90, denominator: 3 });
});
