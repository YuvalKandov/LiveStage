import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./client";
import { generateKey } from "../auth/keys";
import { ADMIN_TOKEN } from "../auth/middleware";
import { nowIso } from "../util";
import { PORT } from "../server";

// Seeds the one demo project, its mobile + service keys, and the Journey template `trip-status`.
// Re-running regenerates the keys (old ones are dropped) and rewrites .seeded-keys.json. The raw
// keys are shown ONCE; only the secret hashes are stored.

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "demo-project";

const db = openDatabase();
const now = nowIso();

const seed = db.transaction(() => {
  db.prepare(`INSERT OR REPLACE INTO projects (id, name, created_at) VALUES (?, ?, ?)`).run(
    PROJECT_ID,
    "Demo Project",
    now,
  );

  // Fresh keys each run.
  db.prepare(`DELETE FROM api_keys WHERE project_id = ?`).run(PROJECT_ID);
  const mobile = generateKey("mobile");
  const service = generateKey("service");
  const insertKey = db.prepare(
    `INSERT INTO api_keys (id, project_id, key_hash, key_type, label, revoked, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  );
  insertKey.run(mobile.id, PROJECT_ID, mobile.keyHash, "mobile", "Demo mobile key", now);
  insertKey.run(service.id, PROJECT_ID, service.keyHash, "service", "Demo service key", now);

  db.prepare(
    `INSERT INTO templates
       (id, project_id, template_id, type, display_name, icon, accent, deep_link_base,
        labels_json, zero_state_label, stale_after_seconds, created_at, updated_at)
     VALUES (?, ?, ?, 'journey', ?, 'airplane', 'blue', 'triptogether://trip', ?, NULL, 900, ?, ?)
     ON CONFLICT(project_id, template_id) DO UPDATE SET
       display_name = excluded.display_name,
       icon = excluded.icon,
       accent = excluded.accent,
       deep_link_base = excluded.deep_link_base,
       labels_json = excluded.labels_json,
       stale_after_seconds = excluded.stale_after_seconds,
       updated_at = excluded.updated_at`,
  ).run(
    "tmpl-trip-status",
    PROJECT_ID,
    "trip-status",
    "Trip status",
    JSON.stringify({ nextStepLabel: "Next", targetLabel: "Departs in" }),
    now,
    now,
  );

  return { mobile: mobile.raw, service: service.raw };
});

const keys = seed();
const baseURL = `http://localhost:${PORT}`;

const out = {
  projectId: PROJECT_ID,
  templateId: "trip-status",
  baseURL,
  mobileKey: keys.mobile,
  serviceKey: keys.service,
  adminToken: ADMIN_TOKEN,
};
writeFileSync(join(here, "../../.seeded-keys.json"), JSON.stringify(out, null, 2) + "\n");

console.log("Seeded LiveStage demo project.");
console.log("  projectId :", PROJECT_ID);
console.log("  template  : trip-status (journey)");
console.log("  baseURL   :", baseURL);
console.log("  mobileKey :", keys.mobile);
console.log("  serviceKey:", keys.service);
console.log("  adminToken:", ADMIN_TOKEN, "(local-demo-only)");
console.log("Wrote backend/.seeded-keys.json (gitignored).");
db.close();
