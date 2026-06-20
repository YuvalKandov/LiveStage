import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { HttpError, nowIso } from "../util";
import { requireAdmin } from "../auth/middleware";
import { generateKey, type KeyType } from "../auth/keys";

// Admin-plane project + API key management (build spec §8.3, §12). These are gated by the local-demo
// admin token, the third trust plane - distinct from the mobile key (SDK) and service key (Insights).
// A key is presented once at creation; the server stores only the hash of its secret, never the raw
// key, so a listing can show metadata but can never reveal a usable key again.

interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
}

interface ApiKeyMetaRow {
  id: string;
  project_id: string;
  key_type: string;
  label: string | null;
  revoked: number;
  created_at: string;
}

export function registerAdminProjectRoutes(app: FastifyInstance, db: Database): void {
  // GET /v1/admin/projects - list projects (most recent first).
  app.get("/v1/admin/projects", (req, reply) => {
    requireAdmin(req);
    const rows = db.prepare(`SELECT id, name, created_at FROM projects ORDER BY created_at DESC`).all() as ProjectRow[];
    return reply.send({
      projects: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at })),
    });
  });

  // POST /v1/admin/projects - create a project. Body: { name }.
  app.post("/v1/admin/projects", (req, reply) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as { name?: string };
    const name = body.name?.trim();
    if (!name) throw new HttpError(400, "validation", "name is required.", "name");
    if (name.length > 80) throw new HttpError(400, "validation", "name exceeds the 80-character limit.", "name");

    const id = randomUUID();
    const now = nowIso();
    db.prepare(`INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)`).run(id, name, now);
    return reply.send({ id, name, createdAt: now });
  });

  // GET /v1/admin/api-keys?projectId= - list key METADATA (never the secret). The raw key only ever
  // exists in the create response below; here only id/type/label/revoked/created are returned.
  app.get("/v1/admin/api-keys", (req, reply) => {
    requireAdmin(req);
    const { projectId } = req.query as { projectId?: string };
    const rows = (
      projectId
        ? db
            .prepare(
              `SELECT id, project_id, key_type, label, revoked, created_at FROM api_keys
               WHERE project_id = ? ORDER BY created_at DESC`,
            )
            .all(projectId)
        : db
            .prepare(`SELECT id, project_id, key_type, label, revoked, created_at FROM api_keys ORDER BY created_at DESC`)
            .all()
    ) as ApiKeyMetaRow[];

    return reply.send({
      keys: rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        keyType: r.key_type,
        label: r.label ?? "",
        revoked: r.revoked === 1,
        createdAt: r.created_at,
      })),
    });
  });

  // POST /v1/admin/api-keys - generate a key. Body: { projectId, keyType: mobile|service, label }.
  // Returns the raw key ONCE; only the hash of the secret is stored (build spec §12).
  app.post("/v1/admin/api-keys", (req, reply) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as { projectId?: string; keyType?: string; label?: string };
    if (!body.projectId) throw new HttpError(400, "validation", "projectId is required.", "projectId");
    if (body.keyType !== "mobile" && body.keyType !== "service") {
      throw new HttpError(400, "validation", "keyType must be 'mobile' or 'service'.", "keyType");
    }
    const project = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(body.projectId) as { id: string } | undefined;
    if (!project) throw new HttpError(404, "project_not_found", `No project ${body.projectId}.`);

    const label = (body.label ?? "").trim();
    if (label.length > 60) throw new HttpError(400, "validation", "label exceeds the 60-character limit.", "label");

    const keyType = body.keyType as KeyType;
    const generated = generateKey(keyType);
    const now = nowIso();
    db.prepare(
      `INSERT INTO api_keys (id, project_id, key_hash, key_type, label, revoked, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    ).run(generated.id, body.projectId, generated.keyHash, keyType, label, now);

    // The raw key is returned exactly once. It is not stored and cannot be retrieved later.
    return reply.send({
      id: generated.id,
      projectId: body.projectId,
      keyType,
      label,
      key: generated.raw,
      createdAt: now,
    });
  });

  // POST /v1/admin/api-keys/:id/revoke - revoke a key so resolveKey rejects it (401) thereafter.
  app.post("/v1/admin/api-keys/:id/revoke", (req, reply) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const info = db.prepare(`UPDATE api_keys SET revoked = 1 WHERE id = ?`).run(id);
    if (info.changes === 0) throw new HttpError(404, "key_not_found", `No API key ${id}.`);
    return reply.send({ id, revoked: true });
  });
}
