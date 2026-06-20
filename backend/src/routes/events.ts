import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { HttpError, isoDate, nowIso } from "../util";
import { requireMobileKey } from "../auth/middleware";
import { bumpDaily } from "../analytics/daily";

// The locked §4.8 event set, verbatim. No custom event types in V1.
const EVENT_TYPES = new Set([
  "activity_started",
  "state_applied",
  "activity_opened",
  "expanded_action_tapped",
  "activity_ended",
  "sync_failed",
  "dismissal_observed",
]);

// metadata is for non-personal qualifiers only (§4.8). Any other key means the client tried to put
// content where it must never go, so the event is discarded rather than stored.
const ALLOWED_METADATA_KEYS = new Set(["source", "reason"]);

interface RawEvent {
  eventId?: unknown;
  sessionId?: unknown;
  installationId?: unknown;
  templateId?: unknown;
  eventType?: unknown;
  version?: unknown;
  occurredAt?: unknown;
  metadata?: unknown;
}

interface SessionLookup {
  id: string;
  project_id: string;
  template_id: string;
}

type Discard = { eventId: string; reason: string };

export function registerEventRoutes(app: FastifyInstance, db: Database): void {
  // POST /v1/events/batch — ingest analytics events (mobile key; the SDK calls this). Idempotent by
  // event_id (a re-uploaded batch never double-counts). Returns explicit per-event results: a valid
  // batch with individually unusable events is still 200 with those listed under `discarded` — only a
  // malformed request body is a 400 (build spec §8.3/§8.6).
  app.post("/v1/events/batch", (req, reply) => {
    const key = requireMobileKey(db, req);
    const body = req.body as { events?: unknown } | undefined;
    if (!body || typeof body !== "object" || !Array.isArray(body.events)) {
      throw new HttpError(400, "validation", "Body must be { events: [...] }.", "events");
    }

    const receivedAt = nowIso();
    const date = isoDate(receivedAt);
    let accepted = 0;
    let duplicates = 0;
    const discarded: Discard[] = [];

    const findSession = db.prepare(
      `SELECT id, project_id, template_id FROM activity_sessions WHERE id = ?`,
    );

    for (const raw of body.events as RawEvent[]) {
      const eventId = typeof raw?.eventId === "string" ? raw.eventId : "";
      if (!eventId) {
        discarded.push({ eventId: String(raw?.eventId ?? ""), reason: "invalid_event" });
        continue;
      }
      if (
        typeof raw.sessionId !== "string" ||
        typeof raw.installationId !== "string" ||
        typeof raw.occurredAt !== "string"
      ) {
        discarded.push({ eventId, reason: "invalid_event" });
        continue;
      }
      if (typeof raw.eventType !== "string" || !EVENT_TYPES.has(raw.eventType)) {
        discarded.push({ eventId, reason: "invalid_event_type" });
        continue;
      }
      if (raw.metadata !== undefined && raw.metadata !== null) {
        if (
          typeof raw.metadata !== "object" ||
          Object.keys(raw.metadata as object).some((k) => !ALLOWED_METADATA_KEYS.has(k))
        ) {
          discarded.push({ eventId, reason: "invalid_metadata" });
          continue;
        }
      }

      // Authoritative scoping: derive project_id + template_id from the session row, never trusting
      // the client. An unknown or foreign session is a permanent discard (the client should drop it).
      const session = findSession.get(raw.sessionId) as SessionLookup | undefined;
      if (!session || session.project_id !== key.projectId) {
        discarded.push({ eventId, reason: "invalid_session" });
        continue;
      }

      const outcome = ingestOne(db, {
        eventId,
        session,
        installationId: raw.installationId,
        eventType: raw.eventType,
        version: typeof raw.version === "number" ? raw.version : null,
        occurredAt: raw.occurredAt,
        metadata: raw.metadata == null ? null : JSON.stringify(raw.metadata),
        receivedAt,
        date,
      });
      if (outcome === "duplicate") duplicates++;
      else accepted++;
    }

    return reply.send({ accepted, duplicates, discarded });
  });
}

interface IngestArgs {
  eventId: string;
  session: SessionLookup;
  installationId: string;
  eventType: string;
  version: number | null;
  occurredAt: string;
  metadata: string | null;
  receivedAt: string;
  date: string;
}

/**
 * Inserts one event and, on a genuine new insert, applies its aggregation — all in ONE transaction
 * (build spec §8.6 transactionality). Idempotent: a repeated event_id inserts nothing and returns
 * "duplicate"; the applied_latencies PK (session,version) keeps the ack distinct even beyond that.
 */
function ingestOne(db: Database, a: IngestArgs): "accepted" | "duplicate" {
  const tx = db.transaction((): "accepted" | "duplicate" => {
    const insert = db
      .prepare(
        `INSERT OR IGNORE INTO analytics_events
           (event_id, project_id, session_id, installation_id, template_id,
            event_type, version, occurred_at, received_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.eventId,
        a.session.project_id,
        a.session.id,
        a.installationId,
        a.session.template_id,
        a.eventType,
        a.version,
        a.occurredAt,
        a.receivedAt,
        a.metadata,
      );
    if (insert.changes === 0) return "duplicate";

    if (a.eventType === "state_applied" && a.version != null) {
      recordAppliedLatency(db, a);
    } else if (a.eventType === "activity_opened") {
      recordInteraction(db, a, "opens");
    } else if (a.eventType === "expanded_action_tapped") {
      recordInteraction(db, a, "expanded_action_taps");
    } else if (a.eventType === "sync_failed") {
      // Client-reported failure, surfaced as a separate breakdown count — never the rejection rate.
      bumpDaily(db, { projectId: a.session.project_id, templateId: a.session.template_id, date: a.date, column: "errors" });
    }
    return "accepted";
  });
  return tx();
}

/**
 * For a new state_applied ack, computes acknowledged sync latency on the SERVER clock only
 * (build spec §9/§8.6): T1 = the version's session_states.accepted_at, T2 = this event's
 * received_at. The device occurred_at is never used for the number (clock skew). Distinct by
 * (session, version) via the applied_latencies PK, so a duplicate ack can't inflate apply-success.
 */
function recordAppliedLatency(db: Database, a: IngestArgs): void {
  const stateRow = db
    .prepare(`SELECT accepted_at FROM session_states WHERE session_id = ? AND version = ?`)
    .get(a.session.id, a.version) as { accepted_at: string } | undefined;
  if (!stateRow) return; // ack for a version we don't have (yet) — store the event, skip the latency.

  const latencyMs = Date.parse(a.receivedAt) - Date.parse(stateRow.accepted_at);
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO applied_latencies
         (project_id, template_id, session_id, version, accepted_at, ack_received_at, latency_ms, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      a.session.project_id,
      a.session.template_id,
      a.session.id,
      a.version,
      stateRow.accepted_at,
      a.receivedAt,
      latencyMs,
      a.date,
    );
  if (inserted.changes === 1) {
    const common = { projectId: a.session.project_id, templateId: a.session.template_id, date: a.date };
    bumpDaily(db, { ...common, column: "updates_applied" });
    bumpDaily(db, { ...common, column: "ack_count" });
    bumpDaily(db, { ...common, column: "total_sync_latency_ms", by: latencyMs });
  }
}

/**
 * Counts a newly-inserted interaction event (build spec §8.6): bumps the additive per-type counter
 * (`opens` / `expanded_action_taps`) and, when this is the session's FIRST interaction of the day,
 * bumps the DAILY-distinct `sessions_with_interaction`. Runs inside ingestOne's transaction (after
 * the event row is inserted), so the count below includes the current event: a count of exactly 1
 * means this is the first interaction for the session that day. A later interaction for the same
 * session/day sees count > 1 and does not bump again; a duplicate event_id never reaches here.
 */
function recordInteraction(db: Database, a: IngestArgs, column: "opens" | "expanded_action_taps"): void {
  const common = { projectId: a.session.project_id, templateId: a.session.template_id, date: a.date };
  bumpDaily(db, { ...common, column });

  const sameDayInteractions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM analytics_events
       WHERE session_id = ?
         AND event_type IN ('activity_opened', 'expanded_action_tapped')
         AND substr(received_at, 1, 10) = ?`,
    )
    .get(a.session.id, a.date) as { n: number };
  if (sameDayInteractions.n === 1) {
    bumpDaily(db, { ...common, column: "sessions_with_interaction" });
  }
}
