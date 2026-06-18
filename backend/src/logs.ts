import type { Database } from "better-sqlite3";
import { nowIso } from "./util";

export type LogKind = "start" | "update" | "end" | "reject";
export type LogStatus = "ok" | "error";

/** Appends a lifecycle/rejection log row (build spec §8.2 logs, §8.4). */
export function writeLog(
  db: Database,
  entry: {
    projectId?: string | null;
    sessionId?: string | null;
    kind: LogKind;
    detail?: string | null;
    status: LogStatus;
  },
): void {
  db.prepare(
    `INSERT INTO logs (project_id, session_id, kind, detail, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.projectId ?? null,
    entry.sessionId ?? null,
    entry.kind,
    entry.detail ?? null,
    entry.status,
    nowIso(),
  );
}
