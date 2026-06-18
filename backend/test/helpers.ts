import type { Database } from "better-sqlite3";
import { openDatabase } from "../src/db/client";
import { buildApp } from "../src/server";
import { generateKey } from "../src/auth/keys";
import { nowIso } from "../src/util";

export const PROJECT_ID = "test-project";

/** Builds an in-memory backend seeded with one project, a mobile key, a service key, and the
 *  Journey `trip-status` template — the fixture every route test runs against. */
export function makeTestApp() {
  const db: Database = openDatabase(":memory:");
  const now = nowIso();

  db.prepare(`INSERT INTO projects (id, name, created_at) VALUES (?, 'Test', ?)`).run(PROJECT_ID, now);

  const mobile = generateKey("mobile");
  const service = generateKey("service");
  const insertKey = db.prepare(
    `INSERT INTO api_keys (id, project_id, key_hash, key_type, label, revoked, created_at)
     VALUES (?, ?, ?, ?, '', 0, ?)`,
  );
  insertKey.run(mobile.id, PROJECT_ID, mobile.keyHash, "mobile", now);
  insertKey.run(service.id, PROJECT_ID, service.keyHash, "service", now);

  db.prepare(
    `INSERT INTO templates
       (id, project_id, template_id, type, display_name, icon, accent, deep_link_base,
        labels_json, zero_state_label, stale_after_seconds, created_at, updated_at)
     VALUES ('t1', ?, 'trip-status', 'journey', 'Trip status', 'airplane', 'blue',
             'triptogether://trip', ?, NULL, 900, ?, ?)`,
  ).run(PROJECT_ID, JSON.stringify({ nextStepLabel: "Next", targetLabel: "Departs in" }), now, now);

  const app = buildApp(db);
  return { app, db, mobileKey: mobile.raw, serviceKey: service.raw };
}

export const mobileAuth = (key: string) => ({ authorization: `Bearer ${key}` });

export const journey = (over: Record<string, unknown> = {}) => ({
  type: "journey",
  title: "Trip to Rome",
  currentStep: "Heading to the airport",
  nextStep: "Flight AZ809",
  progress: 0.35,
  statusText: "On time",
  ...over,
});
