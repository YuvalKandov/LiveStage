import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makeTestApp, mobileAuth, journey, PROJECT_ID } from "./helpers";
import { generateKey } from "../src/auth/keys";

async function start(app: ReturnType<typeof makeTestApp>["app"], key: string, headers = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: { ...mobileAuth(key), ...headers },
    payload: { templateId: "trip-status", deepLinkParameters: { tripId: "123" }, payload: journey() },
  });
  return res;
}

test("start creates a session at version 1 with a composed deep link", async () => {
  const { app, mobileKey } = makeTestApp();
  const res = await start(app, mobileKey);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.version, 1);
  assert.equal(body.deepLinkURL, "triptogether://trip?tripId=123");
  assert.equal(body.staleAfterSeconds, 900);
  assert.ok(body.sessionId);
});

test("update increments version monotonically and dedupes a repeated clientMutationId", async () => {
  const { app, mobileKey } = makeTestApp();
  const { sessionId } = (await start(app, mobileKey)).json();

  const mutationId = randomUUID();
  const patch = () =>
    app.inject({
      method: "PATCH",
      url: `/v1/activities/${sessionId}`,
      headers: mobileAuth(mobileKey),
      payload: { clientMutationId: mutationId, payload: journey({ currentStep: "Boarding", progress: 0.6 }) },
    });

  const first = await patch();
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().version, 2);

  // Same mutation id -> original result, no new version.
  const repeat = await patch();
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.json().version, 2);

  // A fresh mutation id -> version 3.
  const third = await app.inject({
    method: "PATCH",
    url: `/v1/activities/${sessionId}`,
    headers: mobileAuth(mobileKey),
    payload: { clientMutationId: randomUUID(), payload: journey({ progress: 0.9 }) },
  });
  assert.equal(third.json().version, 3);
});

test("invalid update (progress 1.4) is rejected 400 and logged as reject; no version bump", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const { sessionId } = (await start(app, mobileKey)).json();

  const res = await app.inject({
    method: "PATCH",
    url: `/v1/activities/${sessionId}`,
    headers: mobileAuth(mobileKey),
    payload: { clientMutationId: randomUUID(), payload: journey({ progress: 1.4 }) },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "progress");

  // Atomicity: nothing partially written — still version 1, one state row, and a reject log exists.
  const session = db.prepare(`SELECT version FROM activity_sessions WHERE id = ?`).get(sessionId) as {
    version: number;
  };
  assert.equal(session.version, 1);
  const stateCount = db.prepare(`SELECT COUNT(*) c FROM session_states WHERE session_id = ?`).get(sessionId) as {
    c: number;
  };
  assert.equal(stateCount.c, 1);
  const rejects = db.prepare(`SELECT COUNT(*) c FROM logs WHERE kind = 'reject'`).get() as { c: number };
  assert.equal(rejects.c, 1);
});

test("end is idempotent and updates after end are rejected 409", async () => {
  const { app, mobileKey } = makeTestApp();
  const { sessionId } = (await start(app, mobileKey)).json();

  const end1 = await app.inject({
    method: "POST",
    url: `/v1/activities/${sessionId}/end`,
    headers: mobileAuth(mobileKey),
    payload: { reason: "done" },
  });
  assert.equal(end1.statusCode, 200);
  assert.equal(end1.json().alreadyEnded, false);

  const end2 = await app.inject({
    method: "POST",
    url: `/v1/activities/${sessionId}/end`,
    headers: mobileAuth(mobileKey),
    payload: {},
  });
  assert.equal(end2.statusCode, 200);
  assert.equal(end2.json().alreadyEnded, true);

  const patch = await app.inject({
    method: "PATCH",
    url: `/v1/activities/${sessionId}`,
    headers: mobileAuth(mobileKey),
    payload: { clientMutationId: randomUUID(), payload: journey() },
  });
  assert.equal(patch.statusCode, 409);
});

test("poll returns the full content state with server-authored metadata", async () => {
  const { app, mobileKey } = makeTestApp();
  const { sessionId } = (await start(app, mobileKey)).json();

  const res = await app.inject({
    method: "GET",
    url: `/v1/activities/${sessionId}`,
    headers: mobileAuth(mobileKey),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, "active");
  assert.equal(body.state.payload.type, "journey");
  assert.equal(body.state.metadata.version, 1);
  assert.ok(body.state.metadata.lastUpdatedAt);
});

test("start idempotency: same key+body returns original; different body conflicts 409", async () => {
  const { app, mobileKey } = makeTestApp();
  const key = randomUUID();
  const first = await start(app, mobileKey, { "idempotency-key": key });
  const second = await start(app, mobileKey, { "idempotency-key": key });
  assert.equal(first.json().sessionId, second.json().sessionId);

  const conflict = await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: { ...mobileAuth(mobileKey), "idempotency-key": key },
    payload: { templateId: "trip-status", deepLinkParameters: { tripId: "999" }, payload: journey() },
  });
  assert.equal(conflict.statusCode, 409);
});

test("start idempotency keys are scoped per project: the same key value never collides across projects", async () => {
  const { app, db, mobileKey } = makeTestApp();

  // A second project whose SDK happens to send the same Idempotency-Key value.
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO projects (id, name, created_at) VALUES ('other-project', 'Other', ?)`).run(now);
  const other = generateKey("mobile");
  db.prepare(
    `INSERT INTO api_keys (id, project_id, key_hash, key_type, label, revoked, created_at)
     VALUES (?, 'other-project', ?, 'mobile', '', 0, ?)`,
  ).run(other.id, other.keyHash, now);
  db.prepare(
    `INSERT INTO templates
       (id, project_id, template_id, type, display_name, icon, accent, deep_link_base,
        labels_json, zero_state_label, stale_after_seconds, created_at, updated_at)
     VALUES ('t-other', 'other-project', 'trip-status', 'journey', 'Trip status', 'airplane', 'blue',
             'othertrip://trip', '{}', NULL, 900, ?, ?)`,
  ).run(now, now);

  const shared = "shared-idempotency-key";
  const first = await start(app, mobileKey, { "idempotency-key": shared });
  const second = await start(app, other.raw, { "idempotency-key": shared });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200, "the second project's start is not a conflict");
  assert.notEqual(first.json().sessionId, second.json().sessionId, "each project gets its own session");

  // The replay stays project-local: repeating within a project returns that project's session.
  const replay = await start(app, other.raw, { "idempotency-key": shared });
  assert.equal(replay.json().sessionId, second.json().sessionId);
});

test("a service key is rejected on mobile activity routes (403, wrong key type)", async () => {
  const { app, serviceKey } = makeTestApp();
  const res = await start(app, serviceKey);
  assert.equal(res.statusCode, 403);
});

test("admin update uses the same authoritative path and shape as the SDK update", async () => {
  const { app, mobileKey } = makeTestApp();
  const { sessionId } = (await start(app, mobileKey)).json();

  const res = await app.inject({
    method: "PATCH",
    url: `/v1/admin/activities/${sessionId}`,
    headers: { authorization: "Bearer dev-admin-token" },
    payload: { payload: journey({ currentStep: "Boarding", progress: 0.7 }) },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.version, 2);
  assert.equal(body.state.payload.currentStep, "Boarding");

  // Same project filter sees it as active.
  const list = await app.inject({
    method: "GET",
    url: "/v1/admin/activities?status=live",
    headers: { authorization: "Bearer dev-admin-token" },
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().sessions.length, 1);
  assert.equal(list.json().sessions[0].status, "active");
  void PROJECT_ID;
});
