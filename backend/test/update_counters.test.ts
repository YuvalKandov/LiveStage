import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { makeTestApp, mobileAuth, journey } from "./helpers";

type App = ReturnType<typeof makeTestApp>["app"];

async function startSession(app: App, key: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: mobileAuth(key),
    payload: { templateId: "trip-status", deepLinkParameters: { tripId: "1" }, payload: journey() },
  });
  return res.json().sessionId as string;
}

const patch = (app: App, key: string, sessionId: string, mutationId: string, payload: Record<string, unknown>) =>
  app.inject({
    method: "PATCH",
    url: `/v1/activities/${sessionId}`,
    headers: mobileAuth(key),
    payload: { clientMutationId: mutationId, payload },
  });

interface Counters {
  update_attempts: number;
  accepted_updates: number;
  rejected_updates: number;
}
const counters = (db: Database): Counters =>
  (db.prepare(`SELECT update_attempts, accepted_updates, rejected_updates FROM daily_metrics WHERE template_id = 'trip-status'`).get() as
    | Counters
    | undefined) ?? { update_attempts: 0, accepted_updates: 0, rejected_updates: 0 };

const rejectedRows = (db: Database, sessionId: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM rejected_mutations WHERE session_id = ?`).get(sessionId) as { n: number }).n;

test("an accepted update counts one attempt and one accept; a repeated mutationId counts neither", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);

  const m1 = randomUUID();
  const first = await patch(app, mobileKey, sessionId, m1, journey({ progress: 0.6 }));
  assert.equal(first.json().version, 2);
  assert.deepEqual(counters(db), { update_attempts: 1, accepted_updates: 1, rejected_updates: 0 });

  // Retry with the SAME mutation id -> deduped, no new version, no counter movement.
  const repeat = await patch(app, mobileKey, sessionId, m1, journey({ progress: 0.6 }));
  assert.equal(repeat.json().version, 2);
  assert.deepEqual(counters(db), { update_attempts: 1, accepted_updates: 1, rejected_updates: 0 });

  // A fresh mutation -> one more attempt + accept.
  await patch(app, mobileKey, sessionId, randomUUID(), journey({ progress: 0.9 }));
  assert.deepEqual(counters(db), { update_attempts: 2, accepted_updates: 2, rejected_updates: 0 });
});

test("a validation rejection counts one attempt and one rejection; a retried rejection counts neither", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);

  const r1 = randomUUID();
  const bad = () => patch(app, mobileKey, sessionId, r1, journey({ progress: 1.4 })); // out of range -> 400
  const first = await bad();
  assert.equal(first.statusCode, 400);
  assert.deepEqual(counters(db), { update_attempts: 1, accepted_updates: 0, rejected_updates: 1 });
  assert.equal(rejectedRows(db, sessionId), 1);

  // Retry the SAME rejected mutation id -> still 400, but no double-count (rejected_mutations PK).
  const retry = await bad();
  assert.equal(retry.statusCode, 400);
  assert.deepEqual(counters(db), { update_attempts: 1, accepted_updates: 0, rejected_updates: 1 });
  assert.equal(rejectedRows(db, sessionId), 1);
});

test("an update to an ended session is a counted server rejection (409)", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);
  await app.inject({ method: "POST", url: `/v1/activities/${sessionId}/end`, headers: mobileAuth(mobileKey), payload: {} });

  const res = await patch(app, mobileKey, sessionId, randomUUID(), journey({ progress: 0.6 }));
  assert.equal(res.statusCode, 409);
  assert.deepEqual(counters(db), { update_attempts: 1, accepted_updates: 0, rejected_updates: 1 });
});

test("update_attempts = accepted + rejected over distinct logical mutations", async () => {
  const { app, db, mobileKey } = makeTestApp();
  const sessionId = await startSession(app, mobileKey);

  await patch(app, mobileKey, sessionId, randomUUID(), journey({ progress: 0.6 })); // accept
  await patch(app, mobileKey, sessionId, randomUUID(), journey({ progress: 5 })); // reject (out of range)

  const c = counters(db);
  assert.equal(c.accepted_updates, 1);
  assert.equal(c.rejected_updates, 1);
  assert.equal(c.update_attempts, c.accepted_updates + c.rejected_updates);
});
