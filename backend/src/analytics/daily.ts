import type { Database } from "better-sqlite3";

// The pre-aggregated daily_metrics columns (build spec §8.2). daily_metrics is for ADDITIVE totals
// and per-day charts only — the cohort-aligned hero metrics are computed fresh from raw tables at
// read time (§8.6), so a rollup error can never make a hero exceed 100%.
//
// Two sources feed it (§8.2): [server-op] columns from authoritative HTTP activity/update
// processing, and [client-event] columns from analytics_events at ingest. Every increment here is
// expected to run INSIDE the caller's transaction, alongside the raw write it accompanies (§8.6
// transactionality rule), and only on a genuine new insert so a retry can't inflate it.
export type DailyColumn =
  | "sessions_started"
  | "sessions_ended"
  | "update_attempts"
  | "accepted_updates"
  | "rejected_updates"
  | "late_application_sessions"
  | "updates_applied"
  | "opens"
  | "expanded_action_taps"
  | "sessions_with_interaction"
  | "errors"
  | "ack_count"
  | "total_sync_latency_ms";

// Whitelist guard: the column name is interpolated into SQL, so it must come from this fixed set.
const COLUMNS: ReadonlySet<DailyColumn> = new Set<DailyColumn>([
  "sessions_started", "sessions_ended", "update_attempts", "accepted_updates", "rejected_updates",
  "late_application_sessions", "updates_applied", "opens", "expanded_action_taps",
  "sessions_with_interaction", "errors", "ack_count", "total_sync_latency_ms",
]);

/** Adds `by` to one daily_metrics counter for (project, template, date), creating the row if absent. */
export function bumpDaily(
  db: Database,
  args: { projectId: string; templateId: string; date: string; column: DailyColumn; by?: number },
): void {
  if (!COLUMNS.has(args.column)) throw new Error(`Unknown daily_metrics column: ${args.column}`);
  const by = args.by ?? 1;
  db.prepare(
    `INSERT INTO daily_metrics (project_id, template_id, date, ${args.column})
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, template_id, date)
       DO UPDATE SET ${args.column} = ${args.column} + excluded.${args.column}`,
  ).run(args.projectId, args.templateId, args.date, by);
}
