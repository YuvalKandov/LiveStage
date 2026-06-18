import { API_BASE, ADMIN_TOKEN } from "./config";
import type { AdminSession, ApiError, JourneyPayload, LogRow, UpdateResult } from "./types";

/** An error that carries the backend's structured { error, message, field } (e.g. a 400 validation). */
export class PortalApiError extends Error {
  constructor(public status: number, public body: ApiError) {
    super(body.message || body.error);
  }
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
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
export function updateSession(sessionId: string, payload: JourneyPayload): Promise<UpdateResult> {
  return adminFetch(`/v1/admin/activities/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ mutationId: crypto.randomUUID(), payload }),
  });
}

/** Lifecycle + rejection logs (build spec §8.3: GET /v1/admin/logs). */
export function listLogs(): Promise<{ logs: LogRow[] }> {
  return adminFetch("/v1/admin/logs");
}
