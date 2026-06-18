import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makeTestApp, mobileAuth, countdown, progress, futureInstant } from "./helpers";

type App = ReturnType<typeof makeTestApp>["app"];

function start(app: App, key: string, templateId: string, payload: unknown, params: Record<string, string>) {
  return app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: mobileAuth(key),
    payload: { templateId, deepLinkParameters: params, payload },
  });
}

function patch(app: App, key: string, sessionId: string, payload: unknown) {
  return app.inject({
    method: "PATCH",
    url: `/v1/activities/${sessionId}`,
    headers: mobileAuth(key),
    payload: { clientMutationId: randomUUID(), payload },
  });
}

// ---- Countdown ----

test("countdown: start + update run the full loop and round-trip the payload", async () => {
  const { app, mobileKey } = makeTestApp();
  const started = await start(app, mobileKey, "flight-countdown", countdown(), { flightId: "AZ809" });
  assert.equal(started.statusCode, 200);
  assert.equal(started.json().deepLinkURL, "triptogether://flight?flightId=AZ809");
  const { sessionId } = started.json();

  const updated = await patch(app, mobileKey, sessionId, countdown({ statusText: "Delayed 20 min" }));
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().version, 2);
  assert.equal(updated.json().state.payload.type, "countdown");
  assert.equal(updated.json().state.payload.statusText, "Delayed 20 min");
});

test("countdown: missing targetDate is rejected 400", async () => {
  const { app, mobileKey } = makeTestApp();
  const res = await start(app, mobileKey, "flight-countdown", countdown({ targetDate: undefined }), {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "targetDate");
});

test("countdown: a naive (timezone-less) targetDate is rejected 400", async () => {
  const { app, mobileKey } = makeTestApp();
  const res = await start(app, mobileKey, "flight-countdown", countdown({ targetDate: "2026-06-18T18:42:00" }), {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "targetDate");
});

test("countdown: a payload whose type does not match the template is rejected 400", async () => {
  const { app, mobileKey } = makeTestApp();
  const res = await start(app, mobileKey, "flight-countdown", progress(), {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "type");
});

// ---- Progress ----

test("progress: start + update run the full loop and round-trip the payload", async () => {
  const { app, mobileKey } = makeTestApp();
  const started = await start(app, mobileKey, "order-progress", progress(), { orderId: "42" });
  assert.equal(started.statusCode, 200);
  assert.equal(started.json().deepLinkURL, "triptogether://order?orderId=42");
  const { sessionId } = started.json();

  const updated = await patch(app, mobileKey, sessionId, progress({ progress: 1, currentStage: "Done" }));
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().version, 2);
  assert.equal(updated.json().state.payload.progress, 1);
});

test("progress: missing progress is rejected 400", async () => {
  const { app, mobileKey } = makeTestApp();
  const res = await start(app, mobileKey, "order-progress", progress({ progress: undefined }), {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "progress");
});

test("progress: progress out of range (1.4) is rejected 400", async () => {
  const { app, mobileKey } = makeTestApp();
  const res = await start(app, mobileKey, "order-progress", progress({ progress: 1.4 }), {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "progress");
});

test("progress: optional estimatedCompletionDate accepts a tz-aware instant", async () => {
  const { app, mobileKey } = makeTestApp();
  const res = await start(
    app,
    mobileKey,
    "order-progress",
    progress({ estimatedCompletionDate: futureInstant(60) }),
    {},
  );
  assert.equal(res.statusCode, 200);
});

test("progress: over-limit detailText (>24) is rejected 400", async () => {
  const { app, mobileKey } = makeTestApp();
  const res = await start(app, mobileKey, "order-progress", progress({ detailText: "x".repeat(25) }), {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "detailText");
});
