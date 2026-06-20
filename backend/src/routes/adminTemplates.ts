import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { HttpError, nowIso } from "../util";
import { requireAdmin } from "../auth/middleware";
import { validateTemplate } from "../validation/template";
import type { TemplateLabels } from "../models";

// Admin-plane template authoring (build spec §8.3, §8.4). Create/edit go through validateTemplate,
// which enforces the icon allowlist + accent palette + type + lengths. zeroStateLabel is stored in
// the internal `zero_state_label` column and folded into `labels.zeroStateLabel` on read - the single
// source of truth the renderer depends on. Editing a template affects NEW activities only; running
// activities keep their frozen attributes_json (template-config immutability, §4.4).

interface TemplateRow {
  id: string;
  project_id: string;
  template_id: string;
  type: string;
  display_name: string;
  icon: string;
  accent: string;
  deep_link_base: string;
  labels_json: string;
  zero_state_label: string | null;
  stale_after_seconds: number;
}

/** Folds a row into the API shape: labels carry zeroStateLabel from the internal column (one truth). */
function foldRow(row: TemplateRow) {
  const labels = JSON.parse(row.labels_json) as TemplateLabels;
  labels.zeroStateLabel = row.zero_state_label ?? null;
  return {
    id: row.id,
    projectId: row.project_id,
    templateId: row.template_id,
    type: row.type,
    displayName: row.display_name,
    icon: row.icon,
    accent: row.accent,
    deepLinkBase: row.deep_link_base,
    labels,
    staleAfterSeconds: row.stale_after_seconds,
  };
}

export function registerAdminTemplateRoutes(app: FastifyInstance, db: Database): void {
  // GET /v1/admin/templates?projectId= - list templates (folded), optionally scoped to a project.
  app.get("/v1/admin/templates", (req, reply) => {
    requireAdmin(req);
    const { projectId } = req.query as { projectId?: string };
    const rows = (
      projectId
        ? db.prepare(`SELECT * FROM templates WHERE project_id = ? ORDER BY display_name`).all(projectId)
        : db.prepare(`SELECT * FROM templates ORDER BY display_name`).all()
    ) as TemplateRow[];
    return reply.send({ templates: rows.map(foldRow) });
  });

  // POST /v1/admin/templates - create. Body: { projectId, templateId, type, displayName, icon,
  // accent, deepLinkBase, labels{...,zeroStateLabel}, staleAfterSeconds? }.
  app.post("/v1/admin/templates", (req, reply) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!body.projectId) throw new HttpError(400, "validation", "projectId is required.", "projectId");
    const project = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(body.projectId) as { id: string } | undefined;
    if (!project) throw new HttpError(404, "project_not_found", `No project ${body.projectId}.`);

    const v = validateTemplate(body);

    const existing = db
      .prepare(`SELECT id FROM templates WHERE project_id = ? AND template_id = ?`)
      .get(body.projectId, v.templateId);
    if (existing) throw new HttpError(409, "template_exists", `Template "${v.templateId}" already exists in this project.`);

    const id = randomUUID();
    const now = nowIso();
    db.prepare(
      `INSERT INTO templates
         (id, project_id, template_id, type, display_name, icon, accent, deep_link_base,
          labels_json, zero_state_label, stale_after_seconds, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, body.projectId, v.templateId, v.type, v.displayName, v.icon, v.accent, v.deepLinkBase,
      v.labelsJson, v.zeroStateLabel, v.staleAfterSeconds, now, now);

    const row = db.prepare(`SELECT * FROM templates WHERE id = ?`).get(id) as TemplateRow;
    return reply.send(foldRow(row));
  });

  // PATCH /v1/admin/templates/:id - edit. templateId is immutable (changing it would orphan running
  // sessions); every other field can change and is re-validated as a whole.
  app.patch("/v1/admin/templates/:id", (req, reply) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const row = db.prepare(`SELECT * FROM templates WHERE id = ?`).get(id) as TemplateRow | undefined;
    if (!row) throw new HttpError(404, "template_not_found", `No template ${id}.`);

    const body = (req.body ?? {}) as Record<string, unknown>;
    // Merge body over the existing folded values, then validate the whole result. templateId is fixed.
    const merged = {
      templateId: row.template_id,
      type: body.type ?? row.type,
      displayName: body.displayName ?? row.display_name,
      icon: body.icon ?? row.icon,
      accent: body.accent ?? row.accent,
      deepLinkBase: body.deepLinkBase ?? row.deep_link_base,
      labels: body.labels ?? foldRow(row).labels,
      staleAfterSeconds: body.staleAfterSeconds ?? row.stale_after_seconds,
    };
    const v = validateTemplate(merged);

    const now = nowIso();
    db.prepare(
      `UPDATE templates SET type = ?, display_name = ?, icon = ?, accent = ?, deep_link_base = ?,
         labels_json = ?, zero_state_label = ?, stale_after_seconds = ?, updated_at = ? WHERE id = ?`,
    ).run(v.type, v.displayName, v.icon, v.accent, v.deepLinkBase, v.labelsJson, v.zeroStateLabel,
      v.staleAfterSeconds, now, id);

    const updated = db.prepare(`SELECT * FROM templates WHERE id = ?`).get(id) as TemplateRow;
    return reply.send(foldRow(updated));
  });
}
