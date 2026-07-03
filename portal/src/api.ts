import { API_BASE, ADMIN_TOKEN } from "./config";
import type {
  AdminSession,
  ApiError,
  ApiKeyMeta,
  CreatedApiKey,
  KeyType,
  LogRow,
  Project,
  TemplateConfig,
  TemplatePayload,
  UpdateResult,
} from "./types";

/** An error that carries the backend's structured { error, message, field } (e.g. a 400 validation). */
export class PortalApiError extends Error {
  constructor(public status: number, public body: ApiError) {
    super(body.message || body.error);
  }
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    ...((init.headers as Record<string, string>) ?? {}),
  };
  // Only declare a JSON body when one is actually sent. A bodyless POST (e.g. revoke) with
  // Content-Type: application/json makes Fastify reject the request for an empty JSON body.
  if (init.body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new PortalApiError(res.status, json as ApiError);
  }
  return json as T;
}

/** Live sessions for the portal list (build spec §8.3: GET /v1/admin/activities?status=active). */
export function listActiveSessions(): Promise<{ sessions: AdminSession[] }> {
  return adminFetch("/v1/admin/activities?status=active");
}

/** The "Synchronize update" call: PATCH /v1/admin/activities/:id with a payload + a fresh mutation id. */
export function updateSession(sessionId: string, payload: TemplatePayload): Promise<UpdateResult> {
  return adminFetch(`/v1/admin/activities/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ mutationId: crypto.randomUUID(), payload }),
  });
}

/** End a session from the console (POST /v1/admin/activities/:id/end). Idempotent; a per-row
 *  equivalent of the cleanup script. Ends the server session and stops sync (see the button's note:
 *  in V1 the device removes the on-screen activity only when the app itself calls end). */
export function endSessionAdmin(
  sessionId: string,
): Promise<{ status: "ended"; endedAt: string | null; alreadyEnded: boolean }> {
  return adminFetch(`/v1/admin/activities/${encodeURIComponent(sessionId)}/end`, { method: "POST" });
}

/** Lifecycle + rejection logs (build spec §8.3: GET /v1/admin/logs). */
export function listLogs(): Promise<{ logs: LogRow[] }> {
  return adminFetch("/v1/admin/logs");
}

// --- Projects & API keys (admin plane, build spec §8.3/§12) -------------------------------------

export function listProjects(): Promise<{ projects: Project[] }> {
  return adminFetch("/v1/admin/projects");
}

export function createProject(name: string): Promise<Project> {
  return adminFetch("/v1/admin/projects", { method: "POST", body: JSON.stringify({ name }) });
}

export function listApiKeys(projectId: string): Promise<{ keys: ApiKeyMeta[] }> {
  return adminFetch(`/v1/admin/api-keys?projectId=${encodeURIComponent(projectId)}`);
}

/** Generate a key. The response carries the raw key once; the server stores only the secret hash. */
export function createApiKey(projectId: string, keyType: KeyType, label: string): Promise<CreatedApiKey> {
  return adminFetch("/v1/admin/api-keys", {
    method: "POST",
    body: JSON.stringify({ projectId, keyType, label }),
  });
}

export function revokeApiKey(id: string): Promise<{ id: string; revoked: boolean }> {
  return adminFetch(`/v1/admin/api-keys/${encodeURIComponent(id)}/revoke`, { method: "POST" });
}

// --- Templates (admin plane, build spec §8.3/§8.4) ---------------------------------------------

export function listTemplates(projectId?: string): Promise<{ templates: TemplateConfig[] }> {
  const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return adminFetch(`/v1/admin/templates${q}`);
}

/** Create a template. `body` carries the config fields incl. labels (with zeroStateLabel as a label). */
export function createTemplate(body: Record<string, unknown>): Promise<TemplateConfig> {
  return adminFetch("/v1/admin/templates", { method: "POST", body: JSON.stringify(body) });
}

export function updateTemplate(id: string, body: Record<string, unknown>): Promise<TemplateConfig> {
  return adminFetch(`/v1/admin/templates/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
}
