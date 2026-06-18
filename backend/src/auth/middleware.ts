import type { FastifyRequest } from "fastify";
import type { Database } from "better-sqlite3";
import { HttpError } from "../util";
import { bearerToken, resolveKey, type ResolvedKey } from "./keys";

/**
 * Admin token for portal/admin routes. THIS IS LOCAL-DEMO-ONLY: a single static shared secret is
 * not a real auth plane. It exists to keep the admin surface distinct from the mobile/service key
 * planes (build spec §12). A real deployment would use proper admin sessions.
 */
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token";

/** Resolves the request's mobile project key (used by all SDK routes). */
export function requireMobileKey(db: Database, req: FastifyRequest): ResolvedKey {
  return resolveKey(db, bearerToken(req.headers.authorization), "mobile");
}

/** Verifies the local-demo admin token (used by all /v1/admin routes). */
export function requireAdmin(req: FastifyRequest): void {
  const token = bearerToken(req.headers.authorization);
  if (token !== ADMIN_TOKEN) {
    throw new HttpError(401, "unauthorized", "Invalid admin token.");
  }
}
