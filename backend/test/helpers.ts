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

  const insertTemplate = db.prepare(
    `INSERT INTO templates
       (id, project_id, template_id, type, display_name, icon, accent, deep_link_base,
        labels_json, zero_state_label, stale_after_seconds, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 900, ?, ?)`,
  );
  insertTemplate.run("t1", PROJECT_ID, "trip-status", "journey", "Trip status", "airplane", "blue",
    "triptogether://trip", JSON.stringify({ nextStepLabel: "Next", targetLabel: "Departs in" }), null, now, now);
  insertTemplate.run("t2", PROJECT_ID, "flight-countdown", "countdown", "Flight countdown", "clock", "orange",
    "triptogether://flight", JSON.stringify({ countdownLabel: "Boarding in" }), "Boarding now", now, now);
  insertTemplate.run("t3", PROJECT_ID, "order-progress", "progress", "Order progress", "shippingbox", "green",
    "triptogether://order", JSON.stringify({ completionLabel: "Done" }), null, now, now);

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

/** A future, timezone-aware targetDate (Countdown requires a strict ISO-8601 instant). */
export const futureInstant = (minutes = 28) => new Date(Date.now() + minutes * 60_000).toISOString();

export const countdown = (over: Record<string, unknown> = {}) => ({
  type: "countdown",
  title: "Flight to Rome",
  subtitle: "Gate B12",
  targetDate: futureInstant(),
  statusText: "On time",
  location: "Terminal 3",
  ...over,
});

export const progress = (over: Record<string, unknown> = {}) => ({
  type: "progress",
  title: "Preparing your order",
  currentStage: "Packing",
  progress: 0.72,
  detailText: "3 items left",
  ...over,
});
