import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTestApp, journey, PROJECT_ID } from "./helpers";
import { ADMIN_TOKEN } from "../src/auth/middleware";
import { sha256 } from "../src/util";

type App = ReturnType<typeof makeTestApp>["app"];

const adminAuth = { authorization: `Bearer ${ADMIN_TOKEN}` };
const auth = (key: string) => ({ authorization: `Bearer ${key}` });

const createKey = (app: App, projectId: string, keyType: string, label = "") =>
  app.inject({ method: "POST", url: "/v1/admin/api-keys", headers: adminAuth, payload: { projectId, keyType, label } });

// --- projects ---

test("admin: create project then list includes it", async () => {
  const { app } = makeTestApp();
  const created = await app.inject({ method: "POST", url: "/v1/admin/projects", headers: adminAuth, payload: { name: "New App" } });
  assert.equal(created.statusCode, 200);
  const { id } = created.json();
  assert.ok(id);

  const list = await app.inject({ method: "GET", url: "/v1/admin/projects", headers: adminAuth });
  assert.equal(list.statusCode, 200);
  const ids = (list.json().projects as { id: string; name: string }[]).map((p) => p.id);
  assert.ok(ids.includes(id));
});

test("admin: project create requires the admin token", async () => {
  const { app, mobileKey } = makeTestApp();
  const res = await app.inject({ method: "POST", url: "/v1/admin/projects", headers: auth(mobileKey), payload: { name: "X" } });
  assert.equal(res.statusCode, 401); // a mobile key is not the admin plane
});

// --- api keys: shown once, hash of secret only ---

test("admin: api key is returned once as a raw key; only the secret hash is stored", async () => {
  const { app, db } = makeTestApp();
  const res = await createKey(app, PROJECT_ID, "service", "Insights reader");
  assert.equal(res.statusCode, 200);
  const body = res.json() as { id: string; key: string; keyType: string };
  assert.equal(body.keyType, "service");
  // The raw key is present in the create response and has the ls_<type>_<id>.<secret> shape.
  assert.match(body.key, /^ls_service_[A-Za-z0-9]+\.[A-Za-z0-9]+$/);

  const secret = body.key.split(".")[1];
  const row = db.prepare(`SELECT key_hash FROM api_keys WHERE id = ?`).get(body.id) as { key_hash: string };
  // Stored value is the hash of the SECRET only - never the raw key or the bare secret.
  assert.equal(row.key_hash, sha256(secret));
  assert.notEqual(row.key_hash, secret);
  assert.notEqual(row.key_hash, body.key);
});

test("admin: api key listing returns metadata only, never the secret", async () => {
  const { app } = makeTestApp();
  const created = await createKey(app, PROJECT_ID, "mobile", "Shippable");
  const newId = created.json().id as string;

  const list = await app.inject({ method: "GET", url: `/v1/admin/api-keys?projectId=${PROJECT_ID}`, headers: adminAuth });
  assert.equal(list.statusCode, 200);
  const keys = list.json().keys as Record<string, unknown>[];
  const mine = keys.find((k) => k.id === newId)!;
  assert.ok(mine);
  assert.equal(mine.keyType, "mobile");
  assert.equal(mine.revoked, false);
  // No raw key and no hash are ever exposed by the listing.
  assert.equal(mine.key, undefined);
  assert.equal(mine.key_hash, undefined);
  assert.equal((mine as { keyHash?: unknown }).keyHash, undefined);
});

test("admin: a freshly generated mobile key actually authenticates an SDK route", async () => {
  const { app } = makeTestApp();
  const key = (await createKey(app, PROJECT_ID, "mobile")).json().key as string;
  const res = await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: auth(key),
    payload: { templateId: "trip-status", deepLinkParameters: { tripId: "1" }, payload: journey() },
  });
  assert.equal(res.statusCode, 200); // hash-then-verify resolves the new key
});

// --- revoke -> 401 ---

test("admin: revoking a key makes it resolve as 401 thereafter", async () => {
  const { app } = makeTestApp();
  const created = await createKey(app, PROJECT_ID, "service");
  const id = created.json().id as string;
  const key = created.json().key as string;

  // Works before revoke.
  const before = await app.inject({ method: "GET", url: "/v1/insights/summary", headers: auth(key) });
  assert.equal(before.statusCode, 200);

  const revoked = await app.inject({ method: "POST", url: `/v1/admin/api-keys/${id}/revoke`, headers: adminAuth });
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.json().revoked, true);

  // Rejected after revoke.
  const after = await app.inject({ method: "GET", url: "/v1/insights/summary", headers: auth(key) });
  assert.equal(after.statusCode, 401);
});

test("admin: revoking an unknown key is a 404", async () => {
  const { app } = makeTestApp();
  const res = await app.inject({ method: "POST", url: "/v1/admin/api-keys/nope/revoke", headers: adminAuth });
  assert.equal(res.statusCode, 404);
});

// --- plane separation, both directions ---

test("plane separation: a mobile key is rejected by the Insights API (403)", async () => {
  const { app } = makeTestApp();
  const mobile = (await createKey(app, PROJECT_ID, "mobile")).json().key as string;
  const res = await app.inject({ method: "GET", url: "/v1/insights/summary", headers: auth(mobile) });
  assert.equal(res.statusCode, 403);
});

test("plane separation: a service key cannot mutate activities", async () => {
  const { app } = makeTestApp();
  const service = (await createKey(app, PROJECT_ID, "service")).json().key as string;
  const res = await app.inject({
    method: "POST",
    url: "/v1/activities",
    headers: auth(service),
    payload: { templateId: "trip-status", deepLinkParameters: { tripId: "1" }, payload: journey() },
  });
  assert.equal(res.statusCode, 403);
});
