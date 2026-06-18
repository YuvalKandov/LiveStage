import { createHash } from "node:crypto";

/** A handled API error carrying an HTTP status, an error code, and an actionable message. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Current time as an ISO-8601 string (the server clock is authoritative for all metadata). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** UTC date (YYYY-MM-DD) of an ISO timestamp, for the daily_metrics/applied_latencies date column. */
export function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

/** sha256 hex of a string (used for key-secret hashing and idempotency request hashing). */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Stable hash of a JSON value: keys are sorted recursively before serializing, so two requests
 * that are semantically equal hash equally regardless of property order. Used to detect whether a
 * repeated Idempotency-Key carries the same request body or a conflicting one.
 */
export function stableHash(value: unknown): string {
  return sha256(canonicalize(value));
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}
