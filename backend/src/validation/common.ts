import { HttpError } from "../util";

// Text limits (build spec §4.6), keyed by field name and shared across all template validators so
// the contract is enforced identically everywhere. The server rejects values over the hard limit;
// the client truncates per the design doc's per-surface rules.
export const TEXT_LIMITS = {
  title: 60,
  displayName: 40,
  subtitle: 40,
  currentStep: 40,
  nextStep: 40,
  currentStage: 40,
  location: 40,
  statusText: 24,
  detailText: 24,
} as const;

export type TextField = keyof typeof TEXT_LIMITS;

/** Throws a 400 carrying the offending field + an actionable message (turned into a reject log). */
export function fail(field: string, message: string): never {
  throw new HttpError(400, "validation", message, field);
}

/** Validates an optional/required string field against its §4.6 character limit. */
export function checkText(field: TextField, value: unknown, required: boolean): void {
  if (value === undefined || value === null) {
    if (required) fail(field, `${field} is required.`);
    return;
  }
  if (typeof value !== "string") fail(field, `${field} must be a string.`);
  if ((value as string).length > TEXT_LIMITS[field]) {
    fail(field, `${field} exceeds the ${TEXT_LIMITS[field]}-character limit.`);
  }
}

/** Validates a 0..1 progress value (optional for Journey, required for Progress). */
export function checkProgress(value: unknown, required: boolean): void {
  if (value === undefined || value === null) {
    if (required) fail("progress", "progress is required.");
    return;
  }
  if (typeof value !== "number" || Number.isNaN(value)) fail("progress", "progress must be a number.");
  if ((value as number) < 0 || (value as number) > 1) {
    fail("progress", `progress out of range (${value}); must be between 0 and 1.`);
  }
}

// A strict timezone-aware ISO-8601 / RFC3339 instant: date + time + an explicit offset or `Z`.
// Naive/local datetimes (no zone) are rejected so every stored instant is unambiguous.
const RFC3339_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Validates an optional/required timezone-aware ISO-8601 instant (e.g. Countdown's targetDate). */
export function checkInstant(field: string, value: unknown, required: boolean): void {
  if (value === undefined || value === null) {
    if (required) fail(field, `${field} is required.`);
    return;
  }
  if (typeof value !== "string" || !RFC3339_TZ.test(value) || Number.isNaN(Date.parse(value))) {
    fail(field, `${field} must be a timezone-aware ISO-8601 instant (e.g. 2026-06-18T18:42:00Z).`);
  }
}
