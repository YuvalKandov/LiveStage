import { randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";
import { HttpError, sha256 } from "../util";

export type KeyType = "mobile" | "service";

export interface ResolvedKey {
  id: string;
  projectId: string;
  keyType: KeyType;
}

interface ApiKeyRow {
  id: string;
  project_id: string;
  key_hash: string;
  key_type: string;
  revoked: number;
}

// Key format: ls_<type>_<id>.<secret> (build spec §12). Only the secret's hash is stored; the
// server resolves the single row by <id>, then verifies the secret — it never scans all hashes.
const KEY_RE = /^ls_(mobile|service)_([A-Za-z0-9]+)\.([A-Za-z0-9]+)$/;

/** Generates a fresh key plus the row fields to store (the raw key is shown to the operator once). */
export function generateKey(keyType: KeyType): {
  raw: string;
  id: string;
  keyHash: string;
} {
  const id = randomBytes(8).toString("hex");
  const secret = randomBytes(24).toString("hex");
  const raw = `ls_${keyType}_${id}.${secret}`;
  return { raw, id, keyHash: sha256(secret) };
}

/** Extracts the Bearer token from an Authorization header value, or throws 401. */
export function bearerToken(authorization: string | undefined): string {
  if (!authorization) throw new HttpError(401, "unauthorized", "Missing Authorization header.");
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) throw new HttpError(401, "unauthorized", "Authorization must be a Bearer token.");
  return match[1];
}

/**
 * Resolves and verifies a presented project key. Parses the lookup id, fetches that one row,
 * verifies the secret hash, checks it is not revoked, and (when `requiredType` is given) enforces
 * the key type — so a `service` key cannot mutate activities and a `mobile` key cannot read Insights.
 */
export function resolveKey(db: Database, presented: string, requiredType?: KeyType): ResolvedKey {
  const parsed = KEY_RE.exec(presented);
  if (!parsed) throw new HttpError(401, "unauthorized", "Malformed API key.");
  const [, keyType, id, secret] = parsed;

  const row = db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRow | undefined;
  if (!row || row.revoked) throw new HttpError(401, "unauthorized", "Unknown or revoked API key.");
  if (sha256(secret) !== row.key_hash) throw new HttpError(401, "unauthorized", "Invalid API key.");
  if (row.key_type !== keyType) throw new HttpError(401, "unauthorized", "API key type mismatch.");

  if (requiredType && row.key_type !== requiredType) {
    throw new HttpError(
      403,
      "forbidden",
      `This route requires a ${requiredType} key (got ${row.key_type}).`,
    );
  }
  return { id: row.id, projectId: row.project_id, keyType: row.key_type as KeyType };
}
