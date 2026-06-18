import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { HttpError } from "../util";
import { requireAdmin } from "../auth/middleware";
import { validatePayload } from "../validation/index";
import { applyUpdate } from "../services/updateService";
import { writeLog } from "../logs";
import type { SessionRow } from "../repo";
import type { TemplateType } from "../models";

export function registerAdminRoutes(app: FastifyInstance, db: Database): void {
  // GET /v1/admin/activities?status=active — sessions list for the portal. The canonical status
  // value is `active` (matching the server lifecycle); `live` is accepted as an alias for it.
  app.get("/v1/admin/activities", (req, reply) => {
    requireAdmin(req);
    const { status } = req.query as { status?: string };
    const normalized = status === "live" ? "active" : status;
    if (normalized && normalized !== "active" && normalized !== "ended") {
      throw new HttpError(400, "validation", `Unknown status filter "${status}" (use active|ended).`, "status");
    }

    const rows = (
      normalized
        ? db.prepare(`SELECT * FROM activity_sessions WHERE status = ? ORDER BY started_at DESC`).all(normalized)
        : db.prepare(`SELECT * FROM activity_sessions ORDER BY started_at DESC`).all()
    ) as SessionRow[];

    return reply.send({
      sessions: rows.map((r) => ({
        sessionId: r.id,
        templateId: r.template_id,
        type: r.type,
        status: r.status,
        version: r.version,
        lastUpdatedAt: r.last_updated_at,
        startedAt: r.started_at,
        deepLinkURL: r.deep_link_url,
      })),
    });
  });

  // PATCH /v1/admin/activities/:sessionId — the portal "Synchronize update". Same validation and the
  // same transactional updateService as the SDK PATCH, returning the same authoritative response.
  app.patch("/v1/admin/activities/:sessionId", (req, reply) => {
    requireAdmin(req);
    const { sessionId } = req.params as { sessionId: string };
    const body = (req.body ?? {}) as { clientMutationId?: string; mutationId?: string; payload?: unknown };

    const session = db.prepare(`SELECT * FROM activity_sessions WHERE id = ?`).get(sessionId) as
      | SessionRow
      | undefined;
    if (!session) throw new HttpError(404, "session_not_found", `No activity session ${sessionId}.`);

    // A mutation id keeps admin updates retry-safe too; generate one if the portal didn't supply it.
    const clientMutationId = body.clientMutationId ?? body.mutationId ?? randomUUID();

    let payload;
    try {
      payload = validatePayload(body.payload, session.type as TemplateType);
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) {
        writeLog(db, {
          projectId: session.project_id,
          sessionId,
          kind: "reject",
          detail: `${e.field ? e.field + ": " : ""}${e.message}`,
          status: "error",
        });
      }
      throw e;
    }

    const result = applyUpdate(db, { sessionId, clientMutationId, payload });
    return reply.send({ version: result.version, lastUpdatedAt: result.lastUpdatedAt, state: result.state });
  });

  // GET /v1/admin/logs — lifecycle + rejection logs (most recent first).
  app.get("/v1/admin/logs", (req, reply) => {
    requireAdmin(req);
    const rows = db.prepare(`SELECT * FROM logs ORDER BY id DESC LIMIT 200`).all();
    return reply.send({ logs: rows });
  });
}
