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

  // Repeatable upsert: a re-seed corrects EXISTING rows' labels/zero-state too (the SET list covers
  // every mutable column), so changed M1 templates and the new M2 templates all end up correct.
  const upsertTemplate = db.prepare(
    `INSERT INTO templates
       (id, project_id, template_id, type, display_name, icon, accent, deep_link_base,
        labels_json, zero_state_label, stale_after_seconds, created_at, updated_at)
     VALUES (@id, @projectId, @templateId, @type, @displayName, @icon, @accent, @deepLinkBase,
             @labelsJson, @zeroStateLabel, @staleAfterSeconds, @now, @now)
     ON CONFLICT(project_id, template_id) DO UPDATE SET
       type = excluded.type,
       display_name = excluded.display_name,
       icon = excluded.icon,
       accent = excluded.accent,
       deep_link_base = excluded.deep_link_base,
       labels_json = excluded.labels_json,
       zero_state_label = excluded.zero_state_label,
       stale_after_seconds = excluded.stale_after_seconds,
       updated_at = excluded.updated_at`,
  );

  const seedTemplate = (t: {
    id: string;
    templateId: string;
    type: string;
    displayName: string;
    icon: string;
    accent: string;
    deepLinkBase: string;
    labels: Record<string, string>;
    zeroStateLabel: string | null;
    staleAfterSeconds?: number;
  }) =>
    upsertTemplate.run({
      id: t.id,
      projectId: PROJECT_ID,
      templateId: t.templateId,
      type: t.type,
      displayName: t.displayName,
      icon: t.icon,
      accent: t.accent,
      deepLinkBase: t.deepLinkBase,
      labelsJson: JSON.stringify(t.labels),
      zeroStateLabel: t.zeroStateLabel,
      staleAfterSeconds: t.staleAfterSeconds ?? 900,
      now,
    });

  // The three locked templates (design §04-§06). Icons are from the §4.5 allowlist.
  seedTemplate({
    id: "tmpl-trip-status",
    templateId: "trip-status",
    type: "journey",
    displayName: "Trip status",
    icon: "airplane",
    accent: "blue",
    deepLinkBase: "triptogether://trip",
    labels: { nextStepLabel: "Next", targetLabel: "Departs in" },
    zeroStateLabel: null,
  });
  seedTemplate({
    id: "tmpl-flight-countdown",
    templateId: "flight-countdown",
    type: "countdown",
    displayName: "Flight countdown",
    icon: "clock",
    accent: "orange",
    deepLinkBase: "triptogether://flight",
    labels: { countdownLabel: "Boarding in" },
    zeroStateLabel: "Boarding now",
  });
  seedTemplate({
    id: "tmpl-order-progress",
    templateId: "order-progress",
    type: "progress",
    displayName: "Order progress",
    icon: "shippingbox",
    accent: "green",
    deepLinkBase: "triptogether://order",
    labels: { completionLabel: "Done" },
    zeroStateLabel: null,
  });

  // Debug/test template (M2): a Journey with a short stale window so `context.isStale` and the
  // StaleHint can be verified deterministically in the simulator - start it, wait ~20s without an
  // update, and the Lock Screen/expanded de-emphasize; the next update restores the normal look.
  seedTemplate({
    id: "tmpl-stale-demo",
    templateId: "stale-demo",
    type: "journey",
    displayName: "Stale demo (debug)",
    icon: "bell",
    accent: "indigo",
    deepLinkBase: "triptogether://trip",
    labels: { nextStepLabel: "Next", targetLabel: "Departs in" },
    zeroStateLabel: null,
    staleAfterSeconds: 20,
  });

  return { mobile: mobile.raw, service: service.raw };
});

const keys = seed();
const baseURL = `http://localhost:${PORT}`;

const out = {
  projectId: PROJECT_ID,
  templateIds: ["trip-status", "flight-countdown", "order-progress"],
  baseURL,
  mobileKey: keys.mobile,
  serviceKey: keys.service,
  adminToken: ADMIN_TOKEN,
};
writeFileSync(join(here, "../../.seeded-keys.json"), JSON.stringify(out, null, 2) + "\n");

console.log("Seeded LiveStage demo project.");
console.log("  projectId :", PROJECT_ID);
console.log("  templates : trip-status (journey), flight-countdown (countdown), order-progress (progress), stale-demo (journey, 20s stale)");
console.log("  baseURL   :", baseURL);
console.log("  mobileKey :", keys.mobile);
console.log("  serviceKey:", keys.service);
console.log("  adminToken:", ADMIN_TOKEN, "(local-demo-only)");
console.log("Wrote backend/.seeded-keys.json (gitignored).");
db.close();
