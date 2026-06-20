import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { HttpError, isoDate, nowIso } from "../util";
import { requireServiceKey } from "../auth/middleware";

// The developer-facing Insights API (build spec §8.3/§8.6). Service-key only. Every hero metric is
// computed from AUTHORITATIVE RAW TABLES with explicit cohort alignment (not summed daily rows), and
// every rate is returned next to its raw numerator and denominator so it can be audited from curl.
// daily_metrics stays the fast aggregate for additive totals and per-day charts (timeseries, CP6).

const INTERACTION_TYPES = "('activity_opened', 'expanded_action_tapped')";
const FAR_PAST = "1970-01-01T00:00:00.000Z";
const FAR_FUTURE = "9999-12-31T23:59:59.999Z";

interface Rate {
  rate: number | null; // null when the denominator is 0
  numerator: number;
  denominator: number;
}

function rate(numerator: number, denominator: number): Rate {
  return { rate: denominator === 0 ? null : numerator / denominator, numerator, denominator };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface SummaryArgs {
  projectId: string;
  from: string;
  to: string;
  evaluationTime: string;
  templateId?: string; // optional scope for the per-template comparison (CP6)
}

/**
 * Computes the four hero metrics plus supporting totals for a project (optionally one template) over
 * the half-open range [from, to). Cohort rules (build spec §8.6):
 *  - apply-success + acknowledged latency: cohort = post-start accepted versions whose server
 *    accepted_at is in range; acks counted at any time (so the rate can never exceed 100%).
 *  - interaction rate: cohort = sessions whose server started_at is in range.
 *  - update-rejection rate: first-seen logical mutations whose timestamp is in range.
 *  - lateApplicationRate (secondary): deadline-eligible post-start updates only.
 */
export function computeSummary(db: Database, args: SummaryArgs) {
  const { projectId, from, to, evaluationTime, templateId } = args;
  // Shared WHERE fragments. `s` aliases activity_sessions; the template filter is optional.
  const tmplSession = templateId ? "AND s.template_id = @templateId" : "";
  const tmplPlain = templateId ? "AND template_id = @templateId" : "";
  const p = { projectId, from, to, templateId: templateId ?? null };

  // --- apply-success rate: accepted post-start versions (cohort) vs those with an ack (any time) ---
  const apply = db
    .prepare(
      `SELECT
         COUNT(*) AS denom,
         SUM(CASE WHEN al.session_id IS NOT NULL THEN 1 ELSE 0 END) AS numer
       FROM session_states ss
       JOIN activity_sessions s ON s.id = ss.session_id
       LEFT JOIN applied_latencies al ON al.session_id = ss.session_id AND al.version = ss.version
       WHERE s.project_id = @projectId ${tmplSession}
         AND ss.version >= 2 AND ss.accepted_at >= @from AND ss.accepted_at < @to`,
    )
    .get(p) as { denom: number; numer: number | null };
  const applySuccess = rate(apply.numer ?? 0, apply.denom);

  // --- acknowledged sync latency: raw latency_ms for that SAME accepted-version cohort ---
  const latencyRows = db
    .prepare(
      `SELECT al.latency_ms AS ms
       FROM applied_latencies al
       JOIN activity_sessions s ON s.id = al.session_id
       WHERE s.project_id = @projectId ${tmplSession}
         AND al.version >= 2 AND al.accepted_at >= @from AND al.accepted_at < @to`,
    )
    .all(p) as { ms: number }[];
  const latencies = latencyRows.map((r) => r.ms);
  const average = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
  const acknowledgedSyncLatencyMs = { averageMs: average, medianMs: median(latencies), count: latencies.length };

  // --- interaction rate: sessions started in range (cohort) with >=1 interaction (any time) ---
  const interaction = db
    .prepare(
      `SELECT
         COUNT(*) AS denom,
         SUM(CASE WHEN EXISTS (
           SELECT 1 FROM analytics_events e
           WHERE e.session_id = s.id AND e.event_type IN ${INTERACTION_TYPES}
         ) THEN 1 ELSE 0 END) AS numer
       FROM activity_sessions s
       WHERE s.project_id = @projectId ${tmplSession}
         AND s.started_at >= @from AND s.started_at < @to`,
    )
    .get(p) as { denom: number; numer: number | null };
  const interactionRate = rate(interaction.numer ?? 0, interaction.denom);

  // --- update-rejection rate: first-seen logical mutations in range (accepted + rejected, raw) ---
  const acceptedMutations = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM session_states ss
         JOIN activity_sessions s ON s.id = ss.session_id
         WHERE s.project_id = @projectId ${tmplSession}
           AND ss.version >= 2 AND ss.mutation_id IS NOT NULL
           AND ss.accepted_at >= @from AND ss.accepted_at < @to`,
      )
      .get(p) as { n: number }
  ).n;
  const rejectedMutations = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM rejected_mutations
         WHERE project_id = @projectId ${tmplPlain} AND created_at >= @from AND created_at < @to`,
      )
      .get(p) as { n: number }
  ).n;
  const updateRejectionRate = rate(rejectedMutations, acceptedMutations + rejectedMutations);

  // --- lateApplicationRate (secondary): deadline-eligible post-start updates with no on-time ack ---
  const lateRows = db
    .prepare(
      `SELECT ss.accepted_at AS acceptedAt, t.stale_after_seconds AS staleAfter,
         (SELECT al.ack_received_at FROM applied_latencies al
          WHERE al.session_id = ss.session_id AND al.version = ss.version) AS ackReceivedAt
       FROM session_states ss
       JOIN activity_sessions s ON s.id = ss.session_id
       JOIN templates t ON t.project_id = s.project_id AND t.template_id = s.template_id
       WHERE s.project_id = @projectId ${tmplSession}
         AND ss.version >= 2 AND ss.accepted_at >= @from AND ss.accepted_at < @to`,
    )
    .all(p) as { acceptedAt: string; staleAfter: number; ackReceivedAt: string | null }[];
  const evalMs = Date.parse(evaluationTime);
  let lateEligible = 0;
  let lateMissed = 0;
  for (const r of lateRows) {
    const deadline = Date.parse(r.acceptedAt) + r.staleAfter * 1000;
    if (deadline > evalMs) continue; // deadline not passed yet — not eligible
    lateEligible++;
    // late = no ack, or an ack that arrived AFTER the deadline.
    if (r.ackReceivedAt === null || Date.parse(r.ackReceivedAt) > deadline) lateMissed++;
  }
  const lateApplicationRate = rate(lateMissed, lateEligible);

  // --- supporting totals (raw, range-aligned; auditable next to the rates) ---
  const count = (sql: string) => (db.prepare(sql).get(p) as { n: number }).n;
  const sessionsStarted = interaction.denom; // sessions with started_at in range (one source)
  const sessionsEnded = count(
    `SELECT COUNT(*) AS n FROM activity_sessions s WHERE s.project_id = @projectId ${tmplSession}
       AND s.ended_at IS NOT NULL AND s.ended_at >= @from AND s.ended_at < @to`,
  );
  const evType = (type: string) =>
    count(
      `SELECT COUNT(*) AS n FROM analytics_events e
       WHERE e.project_id = @projectId ${templateId ? "AND e.template_id = @templateId" : ""}
         AND e.event_type = '${type}' AND e.received_at >= @from AND e.received_at < @to`,
    );
  const opens = evType("activity_opened");
  const expandedActionTaps = evType("expanded_action_tapped");
  const syncFailures = evType("sync_failed");
  const uniqueInstallations = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT installation_id) AS n FROM analytics_events e
         WHERE e.project_id = @projectId ${templateId ? "AND e.template_id = @templateId" : ""}
           AND e.received_at >= @from AND e.received_at < @to`,
      )
      .get(p) as { n: number }
  ).n;
  const updatesApplied = applySuccess.numerator; // distinct (session,version) acks in cohort

  return {
    projectId,
    range: { from, to, evaluationTime, templateId: templateId ?? null },
    heroes: {
      applySuccessRate: applySuccess,
      acknowledgedSyncLatencyMs,
      interactionRate,
      updateRejectionRate,
    },
    secondary: { lateApplicationRate },
    totals: {
      sessionsStarted,
      sessionsEnded,
      opens,
      expandedActionTaps,
      uniqueInstallations,
      updatesApplied,
      updatesPerSession: sessionsStarted === 0 ? null : updatesApplied / sessionsStarted,
      acceptedUpdates: acceptedMutations,
      rejectedUpdates: rejectedMutations,
      updateAttempts: acceptedMutations + rejectedMutations,
      syncFailures,
    },
  };
}

/** Validates an optional ISO range param, or throws 400. */
function parseRange(query: { from?: string; to?: string }): { from: string; to: string } {
  const from = query.from ?? FAR_PAST;
  const to = query.to ?? FAR_FUTURE;
  if (Number.isNaN(Date.parse(from))) throw new HttpError(400, "validation", `Invalid 'from' date: ${query.from}`, "from");
  if (Number.isNaN(Date.parse(to))) throw new HttpError(400, "validation", `Invalid 'to' date: ${query.to}`, "to");
  return { from, to };
}

// metadata is content-free by contract (§4.8); filter the response to the allowed keys defensively.
const ALLOWED_METADATA_KEYS = new Set(["source", "reason"]);
function filterMetadata(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as Record<string, string>;
  const filtered: Record<string, string> = {};
  for (const k of Object.keys(parsed)) if (ALLOWED_METADATA_KEYS.has(k)) filtered[k] = parsed[k];
  return Object.keys(filtered).length ? filtered : undefined;
}

interface TimelineRow {
  event_id: string;
  event_type: string;
  template_id: string;
  version: number | null;
  occurred_at: string;
  received_at: string;
  metadata_json: string | null;
}

// Per-day timeseries metric registry (build spec §8.6). These read daily_metrics for PER-DAY rows
// only — never to recompute the cohort-aligned range heroes (those come from raw tables, CP4). The
// per-day rate variants are explicitly DAILY/operational, not the range hero of the same name. The
// column names here are fixed (not user input), so they are safe to interpolate.
type MetricKind = "count" | "rate" | "latency";
interface MetricDef {
  kind: MetricKind;
  value?: string; // count column
  num?: string; // rate/latency numerator column
  den?: string; // rate/latency denominator column
  note?: string; // honest per-day labelling
}
const TIMESERIES_METRICS: Record<string, MetricDef> = {
  sessionsStarted: { kind: "count", value: "sessions_started" },
  sessionsEnded: { kind: "count", value: "sessions_ended" },
  opens: { kind: "count", value: "opens" },
  expandedActionTaps: { kind: "count", value: "expanded_action_taps" },
  updatesApplied: { kind: "count", value: "updates_applied" },
  updateAttempts: { kind: "count", value: "update_attempts" },
  acceptedUpdates: { kind: "count", value: "accepted_updates" },
  rejectedUpdates: { kind: "count", value: "rejected_updates" },
  errors: { kind: "count", value: "errors" },
  sessionsWithInteraction: { kind: "count", value: "sessions_with_interaction" },
  updateRejectionRate: { kind: "rate", num: "rejected_updates", den: "update_attempts" },
  applySuccessRate: { kind: "rate", num: "updates_applied", den: "accepted_updates", note: "per-day operational rate (acked applies / accepted updates that day) - not the cohort-aligned range hero" },
  interactionRate: { kind: "rate", num: "sessions_with_interaction", den: "sessions_started", note: "daily started-session interaction rate - not the range cohort summary" },
  averageLatencyMs: { kind: "latency", num: "total_sync_latency_ms", den: "ack_count", note: "per-day average only; the median comes from raw rows (summary), never daily" },
};

export function registerInsightsRoutes(app: FastifyInstance, db: Database): void {
  // GET /v1/insights/summary?from&to — the four hero metrics + supporting totals for the range.
  app.get("/v1/insights/summary", (req, reply) => {
    const key = requireServiceKey(db, req);
    const { from, to } = parseRange(req.query as { from?: string; to?: string });
    return reply.send(computeSummary(db, { projectId: key.projectId, from, to, evaluationTime: nowIso() }));
  });

  // GET /v1/insights/sessions/:sessionId — the session explorer's event timeline (build spec §8.3).
  // Service-key only and scoped to the key's project, so an unknown OR foreign session is a 404 and
  // never leaks cross-project data. The response is content-free: only event identifiers/types/times,
  // never any Live Activity state (titles, locations, status text live in session_states, not here).
  app.get("/v1/insights/sessions/:sessionId", (req, reply) => {
    const key = requireServiceKey(db, req);
    const { sessionId } = req.params as { sessionId: string };

    const session = db
      .prepare(
        `SELECT id, template_id, type, status, started_at, ended_at
         FROM activity_sessions WHERE id = ? AND project_id = ?`,
      )
      .get(sessionId, key.projectId) as
      | { id: string; template_id: string; type: string; status: string; started_at: string; ended_at: string | null }
      | undefined;
    if (!session) throw new HttpError(404, "session_not_found", `No activity session ${sessionId}.`);

    // Acknowledged latency is keyed by (session, version) — applied_latencies is unique per version,
    // so duplicate raw state_applied events resolve to the same single latency (at most one/version).
    const latencyByVersion = new Map<number, number>();
    for (const r of db
      .prepare(`SELECT version, latency_ms FROM applied_latencies WHERE session_id = ?`)
      .all(sessionId) as { version: number; latency_ms: number }[]) {
      latencyByVersion.set(r.version, r.latency_ms);
    }

    // Ordered by occurred_at (device/event time) for the user-facing sequence; received_at breaks ties.
    const rows = db
      .prepare(
        `SELECT event_id, event_type, template_id, version, occurred_at, received_at, metadata_json
         FROM analytics_events WHERE session_id = ? ORDER BY occurred_at ASC, received_at ASC`,
      )
      .all(sessionId) as TimelineRow[];

    const events = rows.map((r) => {
      const item: Record<string, unknown> = {
        eventId: r.event_id,
        eventType: r.event_type,
        templateId: r.template_id,
        occurredAt: r.occurred_at, // device/event time
        receivedAt: r.received_at, // server ingest time
      };
      if (r.version != null) item.version = r.version;
      const metadata = filterMetadata(r.metadata_json);
      if (metadata) item.metadata = metadata;
      if (r.event_type === "state_applied" && r.version != null && latencyByVersion.has(r.version)) {
        item.latencyMs = latencyByVersion.get(r.version);
      }
      return item;
    });

    return reply.send({
      sessionId: session.id,
      templateId: session.template_id,
      type: session.type,
      status: session.status, // lifecycle (active|ended), not user content
      startedAt: session.started_at,
      endedAt: session.ended_at,
      events,
    });
  });

  // GET /v1/insights/templates/:templateId?from&to — the summary scoped to one template, reusing the
  // exact cohort-aligned computeSummary logic (CP4). Service-key only and project-scoped: an unknown
  // or foreign template is a 404 and leaks nothing.
  app.get("/v1/insights/templates/:templateId", (req, reply) => {
    const key = requireServiceKey(db, req);
    const { templateId } = req.params as { templateId: string };
    const exists = db
      .prepare(`SELECT 1 FROM templates WHERE project_id = ? AND template_id = ?`)
      .get(key.projectId, templateId);
    if (!exists) throw new HttpError(404, "template_not_found", `No template ${templateId} in this project.`);
    const { from, to } = parseRange(req.query as { from?: string; to?: string });
    return reply.send(computeSummary(db, { projectId: key.projectId, from, to, evaluationTime: nowIso(), templateId }));
  });

  // GET /v1/insights/timeseries?metric&from&to&interval=day[&templateId] — PER-DAY chart rows from
  // daily_metrics (build spec §8.6). Used only for daily rows, never to recompute a range hero. Each
  // rate row carries its numerator and denominator; each count row carries the raw additive value; a
  // zero denominator yields a null rate, never 0/0.
  app.get("/v1/insights/timeseries", (req, reply) => {
    const key = requireServiceKey(db, req);
    const q = req.query as { metric?: string; from?: string; to?: string; interval?: string; templateId?: string };

    const def = q.metric ? TIMESERIES_METRICS[q.metric] : undefined;
    if (!def) {
      throw new HttpError(400, "validation", `Unknown metric '${q.metric ?? ""}'. Supported: ${Object.keys(TIMESERIES_METRICS).join(", ")}.`, "metric");
    }
    const interval = q.interval ?? "day";
    if (interval !== "day") throw new HttpError(400, "validation", "Only interval=day is supported in V1.", "interval");

    const { from, to } = parseRange(q);
    const params = { projectId: key.projectId, templateId: q.templateId ?? null, fromDate: isoDate(from), toDate: isoDate(to) };
    const where = `WHERE project_id = @projectId ${q.templateId ? "AND template_id = @templateId" : ""} AND date >= @fromDate AND date <= @toDate`;

    let series: unknown[];
    if (def.kind === "count") {
      const rows = db
        .prepare(`SELECT date, SUM(${def.value}) AS value FROM daily_metrics ${where} GROUP BY date ORDER BY date ASC`)
        .all(params) as { date: string; value: number }[];
      series = rows.map((r) => ({ date: r.date, value: r.value }));
    } else {
      const rows = db
        .prepare(`SELECT date, SUM(${def.num}) AS numerator, SUM(${def.den}) AS denominator FROM daily_metrics ${where} GROUP BY date ORDER BY date ASC`)
        .all(params) as { date: string; numerator: number; denominator: number }[];
      series = rows.map((r) => ({
        date: r.date,
        value: r.denominator === 0 ? null : r.numerator / r.denominator,
        numerator: r.numerator,
        denominator: r.denominator,
      }));
    }

    return reply.send({
      metric: q.metric,
      kind: def.kind,
      interval: "day",
      note: def.note,
      range: { from, to, templateId: q.templateId ?? null },
      series,
    });
  });
}
