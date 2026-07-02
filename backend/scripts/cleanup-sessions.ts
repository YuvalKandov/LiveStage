// Ends every stale `active` session so the console's live list is clean before a demo.
//
// Dev sessions pile up because a dismissed/abandoned activity is not server-known in V1 - only an
// explicit `end` closes the server session. This goes through the real API (the same idempotent end
// path the SDK uses, reason "cleanup"), so logs and daily counters stay consistent. The backend must
// be running.
//
// Usage (from backend/):
//   npm run cleanup                     end ALL active sessions
//   npm run cleanup -- --keep-minutes 10   keep sessions started in the last 10 minutes

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

interface SeededKeys {
  baseURL: string;
  mobileKey: string;
  adminToken: string;
}

function seededKeys(): SeededKeys {
  const path = join(here, "../.seeded-keys.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SeededKeys;
  } catch {
    console.error(`Cannot read ${path}. Run \`npm run seed\` first (note: re-seeding rotates keys).`);
    process.exit(1);
  }
}

function keepMinutes(): number {
  const i = process.argv.indexOf("--keep-minutes");
  if (i === -1) return 0;
  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n) || n < 0) {
    console.error("--keep-minutes expects a non-negative number.");
    process.exit(1);
  }
  return n;
}

const { baseURL, mobileKey, adminToken } = seededKeys();
const keepMs = keepMinutes() * 60_000;

const listRes = await fetch(`${baseURL}/v1/admin/activities?status=active`, {
  headers: { authorization: `Bearer ${adminToken}` },
});
if (!listRes.ok) {
  console.error(`Listing sessions failed: ${listRes.status} ${await listRes.text()}`);
  process.exit(1);
}
const { sessions } = (await listRes.json()) as { sessions: { sessionId: string; startedAt: string }[] };

const cutoff = Date.now() - keepMs;
const targets = sessions.filter((s) => Date.parse(s.startedAt) <= cutoff);
console.log(`${sessions.length} active session(s); ending ${targets.length} (keeping ${sessions.length - targets.length} recent).`);

let ended = 0;
let failed = 0;
for (const s of targets) {
  const res = await fetch(`${baseURL}/v1/activities/${s.sessionId}/end`, {
    method: "POST",
    headers: { authorization: `Bearer ${mobileKey}`, "content-type": "application/json" },
    body: JSON.stringify({ reason: "cleanup" }),
  });
  if (res.ok) {
    ended++;
  } else {
    failed++;
    console.error(`  end ${s.sessionId} failed: ${res.status} ${await res.text()}`);
  }
}
console.log(`Done: ${ended} ended${failed ? `, ${failed} failed` : ""}.`);
if (failed > 0) process.exit(1);
