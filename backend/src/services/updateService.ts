import type { Database } from "better-sqlite3";
import { HttpError, isoDate, nowIso } from "../util";
import { writeLog } from "../logs";
import { bumpDaily } from "../analytics/daily";
import type { LiveStageContentState, TemplatePayload } from "../models";

interface SessionRow {
  id: string;
  project_id: string;
  template_id: string;
  type: string;
  status: string;
  version: number;
  last_updated_at: string;
}

interface StateRow {
  version: number;
  payload_json: string;
  accepted_at: string;
}

export interface UpdateResult {
  version: number;
  lastUpdatedAt: string;
  state: LiveStageContentState;
  deduped: boolean;
}

function buildState(row: StateRow): LiveStageContentState {
  return {
    payload: JSON.parse(row.payload_json) as TemplatePayload,
    metadata: { lastUpdatedAt: row.accepted_at, version: row.version },
  };
}

/**
 * The single authoritative, transactional accepted-update path shared by the SDK PATCH and the
 * admin/portal PATCH (build spec §8.4, §9). Everything below runs in one better-sqlite3 transaction
 * so a rejected or duplicate update never leaves a partial write:
 *   lifecycle check -> mutation-id dedupe -> version read/increment -> state insert -> session update -> log.
 *
 * The server is authoritative for `version`, `lastUpdatedAt`, and `accepted_at`; callers supply only
 * the validated payload and their `clientMutationId`. A repeated mutation id returns the original
 * accepted result with no new version (`deduped: true`).
 *
 * The `payload` must already be validated by the caller (so a `400` + `reject` log is produced
 * before the transaction). Throws HttpError(404) if the session is unknown, HttpError(409) if ended.
 */
export function applyUpdate(
  db: Database,
  args: { sessionId: string; clientMutationId: string; payload: TemplatePayload },
): UpdateResult {
  const tx = db.transaction((): UpdateResult => {
    const session = db
      .prepare(
        `SELECT id, project_id, template_id, type, status, version, last_updated_at
         FROM activity_sessions WHERE id = ?`,
      )
      .get(args.sessionId) as SessionRow | undefined;

    if (!session) {
      throw new HttpError(404, "session_not_found", `No activity session ${args.sessionId}.`);
    }
    if (session.status === "ended") {
      throw new HttpError(409, "already_ended", `Session ${args.sessionId} has ended; updates are rejected.`);
    }

    // Mutation-id dedupe: a retried PATCH must not create a second version (build spec §9).
    const existing = db
      .prepare(
        `SELECT version, payload_json, accepted_at FROM session_states
         WHERE session_id = ? AND mutation_id = ?`,
      )
      .get(args.sessionId, args.clientMutationId) as StateRow | undefined;
    if (existing) {
      return {
        version: existing.version,
        lastUpdatedAt: existing.accepted_at,
        state: buildState(existing),
        deduped: true,
      };
    }

    const newVersion = session.version + 1;
    const now = nowIso();

    db.prepare(
      `INSERT INTO session_states (session_id, version, mutation_id, payload_json, accepted_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(args.sessionId, newVersion, args.clientMutationId, JSON.stringify(args.payload), now, now);

    db.prepare(`UPDATE activity_sessions SET version = ?, last_updated_at = ? WHERE id = ?`).run(
      newVersion,
      now,
      args.sessionId,
    );

    writeLog(db, {
      projectId: session.project_id,
      sessionId: args.sessionId,
      kind: "update",
      detail: `version ${newVersion}`,
      status: "ok",
    });

    // [server-op] logical-mutation counters (build spec §8.6): a first-seen ACCEPTED mutation counts
    // one attempt and one accept. The dedupe branch above returns before here, so a retried
    // clientMutationId never bumps either. Same transaction as the version write.
    const date = isoDate(now);
    bumpDaily(db, { projectId: session.project_id, templateId: session.template_id, date, column: "update_attempts" });
    bumpDaily(db, { projectId: session.project_id, templateId: session.template_id, date, column: "accepted_updates" });

    return {
      version: newVersion,
      lastUpdatedAt: now,
      state: { payload: args.payload, metadata: { lastUpdatedAt: now, version: newVersion } },
      deduped: false,
    };
  });

  return tx();
}

/**
 * Records a REJECTED post-start mutation (build spec §8.6) in one transaction: writes the `reject`
 * log and, for a first-seen logical mutation, counts one attempt and one rejection. Idempotent and
 * honest:
 *  - a retried rejection (same session + mutation_id) inserts nothing and counts nothing
 *    (the rejected_mutations PK), so retries never inflate the rate;
 *  - a mutation already ACCEPTED (present in session_states) is never also counted as rejected.
 *
 * Used by the SDK and admin PATCH paths for validation (400) and lifecycle (409 ended) rejections.
 * Start (POST) validation failures are NOT updates and never call this.
 */
export function rejectUpdate(
  db: Database,
  args: { projectId: string; templateId: string; sessionId: string; mutationId: string; reason: string },
): void {
  db.transaction(() => {
    writeLog(db, {
      projectId: args.projectId,
      sessionId: args.sessionId,
      kind: "reject",
      detail: args.reason,
      status: "error",
    });

    const alreadyAccepted = db
      .prepare(`SELECT 1 FROM session_states WHERE session_id = ? AND mutation_id = ?`)
      .get(args.sessionId, args.mutationId);
    if (alreadyAccepted) return;

    const now = nowIso();
    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO rejected_mutations (session_id, mutation_id, project_id, template_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(args.sessionId, args.mutationId, args.projectId, args.templateId, args.reason, now);
    if (inserted.changes === 1) {
      const date = isoDate(now);
      bumpDaily(db, { projectId: args.projectId, templateId: args.templateId, date, column: "update_attempts" });
      bumpDaily(db, { projectId: args.projectId, templateId: args.templateId, date, column: "rejected_updates" });
    }
  })();
}
