import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTestApp, PROJECT_ID } from "./helpers";
import { ADMIN_TOKEN } from "../src/auth/middleware";

type App = ReturnType<typeof makeTestApp>["app"];
const adminAuth = { authorization: `Bearer ${ADMIN_TOKEN}` };

/** A valid create body with optional field overrides (set a key to undefined to drop it). */
function templateBody(over: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    templateId: "ride-status",
    type: "journey",
    displayName: "Ride status",
    icon: "car",
    accent: "indigo",
    deepLinkBase: "triptogether://ride",
    labels: { nextStepLabel: "Next" },
    ...over,
  };
}

const create = (app: App, body: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/admin/templates", headers: adminAuth, payload: body });

// --- happy path ---

test("templates: create a valid template, then it appears in the project listing", async () => {
  const { app } = makeTestApp();
  const res = await create(app, templateBody());
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().templateId, "ride-status");

  const list = await app.inject({ method: "GET", url: `/v1/admin/templates?projectId=${PROJECT_ID}`, headers: adminAuth });
  const ids = (list.json().templates as { templateId: string }[]).map((t) => t.templateId);
  assert.ok(ids.includes("ride-status"));
});

// --- negative cases (the real validation) ---

test("templates: an off-allowlist icon is rejected 400", async () => {
  const { app } = makeTestApp();
  const res = await create(app, templateBody({ icon: "skull" }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "icon");
});

test("templates: an off-palette accent is rejected 400", async () => {
  const { app } = makeTestApp();
  const res = await create(app, templateBody({ accent: "hotpink" }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "accent");
});

test("templates: an unknown type is rejected 400", async () => {
  const { app } = makeTestApp();
  const res = await create(app, templateBody({ type: "route" }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "type");
});

test("templates: an over-length displayName (>40) is rejected 400", async () => {
  const { app } = makeTestApp();
  const res = await create(app, templateBody({ displayName: "x".repeat(41) }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "displayName");
});

test("templates: a deepLinkBase without a scheme is rejected 400", async () => {
  const { app } = makeTestApp();
  const res = await create(app, templateBody({ deepLinkBase: "not-a-url" }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().field, "deepLinkBase");
});

test("templates: a duplicate templateId in the same project is rejected 409", async () => {
  const { app } = makeTestApp();
  assert.equal((await create(app, templateBody())).statusCode, 200);
  const dup = await create(app, templateBody({ displayName: "Ride again" }));
  assert.equal(dup.statusCode, 409);
});

// --- zeroStateLabel folding (stored internal, folded on read; not inside labels_json) ---

test("templates: zeroStateLabel is stored in the internal column and folded into labels on read", async () => {
  const { app, db } = makeTestApp();
  const res = await create(
    app,
    templateBody({
      templateId: "gate-countdown",
      type: "countdown",
      icon: "clock",
      accent: "orange",
      labels: { countdownLabel: "Boarding in", zeroStateLabel: "Boarding now" },
    }),
  );
  assert.equal(res.statusCode, 200);
  // Folded on read: labels carries zeroStateLabel.
  assert.equal(res.json().labels.zeroStateLabel, "Boarding now");
  assert.equal(res.json().labels.countdownLabel, "Boarding in");

  // Stored internally: the column holds it and labels_json does NOT.
  const row = db
    .prepare(`SELECT labels_json, zero_state_label FROM templates WHERE project_id = ? AND template_id = ?`)
    .get(PROJECT_ID, "gate-countdown") as { labels_json: string; zero_state_label: string | null };
  assert.equal(row.zero_state_label, "Boarding now");
  assert.equal(JSON.parse(row.labels_json).zeroStateLabel, undefined);
  assert.equal(JSON.parse(row.labels_json).countdownLabel, "Boarding in");
});

// --- PATCH edits + re-validation ---

test("templates: PATCH edits a field and re-validates the whole template", async () => {
  const { app } = makeTestApp();
  const created = await create(app, templateBody());
  const id = created.json().id as string;

  const ok = await app.inject({
    method: "PATCH",
    url: `/v1/admin/templates/${id}`,
    headers: adminAuth,
    payload: { displayName: "Ride tracker", accent: "teal" },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().displayName, "Ride tracker");
  assert.equal(ok.json().accent, "teal");
  assert.equal(ok.json().templateId, "ride-status"); // immutable

  const bad = await app.inject({
    method: "PATCH",
    url: `/v1/admin/templates/${id}`,
    headers: adminAuth,
    payload: { icon: "skull" },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().field, "icon");
});

test("templates: admin token is required to create", async () => {
  const { app, mobileKey } = makeTestApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/templates",
    headers: { authorization: `Bearer ${mobileKey}` },
    payload: templateBody(),
  });
  assert.equal(res.statusCode, 401);
});
