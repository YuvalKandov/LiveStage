import type { Database } from "better-sqlite3";
import { HttpError } from "./util";
import type {
  AccentStyle,
  LiveStageContentState,
  TemplateConfiguration,
  TemplateLabels,
  TemplatePayload,
  TemplateType,
} from "./models";

interface TemplateRow {
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

export interface SessionRow {
  id: string;
  project_id: string;
  template_id: string;
  type: string;
  deep_link_url: string;
  status: string;
  version: number;
  last_updated_at: string;
  started_at: string;
  ended_at: string | null;
  attributes_json: string;
}

/** Loads a template config for a project, or throws 404. */
export function getTemplate(db: Database, projectId: string, templateId: string): TemplateConfiguration {
  const row = db
    .prepare(`SELECT * FROM templates WHERE project_id = ? AND template_id = ?`)
    .get(projectId, templateId) as TemplateRow | undefined;
  if (!row) throw new HttpError(404, "template_not_found", `No template "${templateId}" in this project.`);
  return {
    templateId: row.template_id,
    templateType: row.type as TemplateType,
    displayName: row.display_name,
    icon: row.icon,
    accentStyle: row.accent as AccentStyle,
    deepLinkBase: row.deep_link_base,
    labels: JSON.parse(row.labels_json) as TemplateLabels,
    zeroStateLabel: row.zero_state_label,
    staleAfterSeconds: row.stale_after_seconds,
  };
}

/** Loads a session row scoped to a project, or throws 404. */
export function getSession(db: Database, projectId: string, sessionId: string): SessionRow {
  const row = db
    .prepare(`SELECT * FROM activity_sessions WHERE id = ? AND project_id = ?`)
    .get(sessionId, projectId) as SessionRow | undefined;
  if (!row) throw new HttpError(404, "session_not_found", `No activity session ${sessionId}.`);
  return row;
}

/** Returns the full content state for a session's current version (poll responses). */
export function currentState(db: Database, sessionId: string): LiveStageContentState {
  const row = db
    .prepare(
      `SELECT version, payload_json, accepted_at FROM session_states
       WHERE session_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(sessionId) as { version: number; payload_json: string; accepted_at: string } | undefined;
  if (!row) throw new HttpError(500, "state_missing", `Session ${sessionId} has no state rows.`);
  return {
    payload: JSON.parse(row.payload_json) as TemplatePayload,
    metadata: { lastUpdatedAt: row.accepted_at, version: row.version },
  };
}
