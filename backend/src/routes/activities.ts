import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { HttpError, isoDate, nowIso, stableHash } from "../util";
import { requireMobileKey } from "../auth/middleware";
import { getSession, getTemplate, currentState } from "../repo";
import { composeDeepLink } from "../deeplink";
import { validatePayload } from "../validation/index";
import { applyUpdate, rejectUpdate } from "../services/updateService";
import { bumpDaily } from "../analytics/daily";
import { writeLog } from "../logs";
import type { ActivityAttributes, TemplateType } from "../models";

/** Runs `fn`; if it throws a 400 (validation/deep-link), writes a `reject` log first, then rethrows. */
function withRejectLog<T>(
  db: Database,
  projectId: string,
  sessionId: string | null,
  fn: () => T,
): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HttpError && e.status === 400) {
      writeLog(db, {
        projectId,
        sessionId,
        kind: "reject",
        // Carry the error code plus the actionable explanation (e.g. "validation · progress: must be 0..1").
        detail: `${e.code} · ${e.field ? e.field + ": " : ""}${e.message}`,
        status: "error",
      });
    }
    throw e;
  }
}

export function registerActivityRoutes(app: FastifyInstance, db: Database): void {
  // POST /v1/activities — start. Body: { templateId, deepLinkParameters, payload }. The server
  // composes the deep link, freezes attributes_json, creates the session at version 1, and writes
  // the first session_states row. Honors a persistent Idempotency-Key (header) for retry safety.
  app.post("/v1/activities", (req, reply) => {
    const key = requireMobileKey(db, req);
    const body = (req.body ?? {}) as {
      templateId?: string;
      deepLinkParameters?: Record<string, string>;
      payload?: unknown;
    };
    if (!body.templateId) throw new HttpError(400, "validation", "templateId is required.", "templateId");

    const template = getTemplate(db, key.projectId, body.templateId);
    const params = body.deepLinkParameters ?? {};

    const { payload, deepLinkURL } = withRejectLog(db, key.projectId, null, () => ({
      payload: validatePayload(body.payload, template.templateType),
      deepLinkURL: composeDeepLink(template.deepLinkBase, params),
    }));

    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    const requestHash = stableHash({ templateId: body.templateId, deepLinkParameters: params, payload });

    // Persistent start idempotency: a repeat with the same key + same body returns the original
    // session; a repeat with a DIFFERENT body is a 409 conflict (build spec: retry-safe start).
    if (idempotencyKey) {
      const prior = db
        .prepare(`SELECT session_id, request_hash FROM start_idempotency WHERE project_id = ? AND key = ?`)
        .get(key.projectId, idempotencyKey) as { session_id: string; request_hash: string } | undefined;
      if (prior) {
        if (prior.request_hash !== requestHash) {
          throw new HttpError(409, "idempotency_conflict", "Idempotency-Key reused with a different request.");
        }
        const existing = getSession(db, key.projectId, prior.session_id);
        return reply.send({
          sessionId: existing.id,
          version: existing.version,
          deepLinkURL: existing.deep_link_url,
          staleAfterSeconds: template.staleAfterSeconds,
          lastUpdatedAt: existing.last_updated_at,
        });
      }
    }

    const sessionId = randomUUID();
    const now = nowIso();
    const attributes: ActivityAttributes = {
      sessionId,
      templateId: template.templateId,
      templateType: template.templateType,
      iconIdentifier: template.icon,
      accentStyle: template.accentStyle,
      labels: template.labels,
      deepLinkURL,
    };

    const create = db.transaction(() => {
      db.prepare(
        `INSERT INTO activity_sessions
           (id, project_id, template_id, type, deep_link_url, status, version,
            last_updated_at, started_at, ended_at, attributes_json)
         VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, NULL, ?)`,
      ).run(
        sessionId,
        key.projectId,
        template.templateId,
        template.templateType,
        deepLinkURL,
        now,
        now,
        JSON.stringify(attributes),
      );

      db.prepare(
        `INSERT INTO session_states (session_id, version, mutation_id, payload_json, accepted_at, created_at)
         VALUES (?, 1, NULL, ?, ?, ?)`,
      ).run(sessionId, JSON.stringify(payload), now, now);

      writeLog(db, { projectId: key.projectId, sessionId, kind: "start", detail: template.templateId, status: "ok" });

      // [server-op] count this real session start (an idempotent-replay return above never reaches
      // here, so a retried start can't double-count). Same transaction as the raw write (§8.6).
      bumpDaily(db, { projectId: key.projectId, templateId: template.templateId, date: isoDate(now), column: "sessions_started" });

      if (idempotencyKey) {
        db.prepare(
          `INSERT INTO start_idempotency (key, project_id, session_id, request_hash, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(idempotencyKey, key.projectId, sessionId, requestHash, now);
      }
    });
    create();

    return reply.send({
      sessionId,
      version: 1,
      deepLinkURL,
      staleAfterSeconds: template.staleAfterSeconds,
      lastUpdatedAt: now,
    });
  });

  // PATCH /v1/activities/:sessionId — update. Body: { clientMutationId, payload }. Payload only;
  // the server authors version/lastUpdatedAt. Goes through the shared transactional updateService.
  app.patch("/v1/activities/:sessionId", (req, reply) => {
    const key = requireMobileKey(db, req);
    const { sessionId } = req.params as { sessionId: string };
    const body = (req.body ?? {}) as { clientMutationId?: string; payload?: unknown };
    if (!body.clientMutationId) {
      throw new HttpError(400, "validation", "clientMutationId is required.", "clientMutationId");
    }

    const session = getSession(db, key.projectId, sessionId);
    const reject = (reason: string) =>
      rejectUpdate(db, {
        projectId: key.projectId,
        templateId: session.template_id,
        sessionId,
        mutationId: body.clientMutationId!,
        reason,
      });

    // A validation (400) rejection is a server-rejected update: count it (deduped by mutation id)
    // and reject. It is NOT a sync_failed — those are transport/server failures (build spec §8.6).
    let payload;
    try {
      payload = validatePayload(body.payload, session.type as TemplateType);
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) reject(`${e.field ? e.field + ": " : ""}${e.message}`);
      throw e;
    }

    // A lifecycle (409 ended) rejection is also a server-rejected update.
    try {
      const result = applyUpdate(db, { sessionId, clientMutationId: body.clientMutationId, payload });
      return reply.send({ version: result.version, lastUpdatedAt: result.lastUpdatedAt, state: result.state });
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) reject(e.code);
      throw e;
    }
  });

  // GET /v1/activities/:sessionId — poll. Returns the full current LiveStageContentState.
  app.get("/v1/activities/:sessionId", (req, reply) => {
    const key = requireMobileKey(db, req);
    const { sessionId } = req.params as { sessionId: string };
    const session = getSession(db, key.projectId, sessionId);
    const template = getTemplate(db, key.projectId, session.template_id);
    return reply.send({
      status: session.status,
      version: session.version,
      lastUpdatedAt: session.last_updated_at,
      state: currentState(db, sessionId),
      staleAfterSeconds: template.staleAfterSeconds,
    });
  });

  // POST /v1/activities/:sessionId/end — idempotent end. active->ended returns ok; ended->ended
  // returns the already-ended result without error (build spec: retry-safe end).
  app.post("/v1/activities/:sessionId/end", (req, reply) => {
    const key = requireMobileKey(db, req);
    const { sessionId } = req.params as { sessionId: string };
    const body = (req.body ?? {}) as { reason?: string };
    const session = getSession(db, key.projectId, sessionId);

    if (session.status === "ended") {
      return reply.send({ status: "ended", endedAt: session.ended_at, alreadyEnded: true });
    }
    const now = nowIso();
    db.transaction(() => {
      db.prepare(`UPDATE activity_sessions SET status = 'ended', ended_at = ? WHERE id = ?`).run(now, sessionId);
      writeLog(db, {
        projectId: key.projectId,
        sessionId,
        kind: "end",
        detail: body.reason ?? null,
        status: "ok",
      });
      // [server-op] count the active->ended transition only (the already-ended path returns above,
      // so a retried end can't double-count). Same transaction as the raw write (§8.6).
      bumpDaily(db, { projectId: key.projectId, templateId: session.template_id, date: isoDate(now), column: "sessions_ended" });
    })();
    return reply.send({ status: "ended", endedAt: now, alreadyEnded: false });
  });
}
