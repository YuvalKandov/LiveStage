import { HttpError } from "../util";
import type { JourneyPayload, TemplatePayload, TemplateType } from "../models";

// Text limits (build spec §4.6). Server rejects values over the hard limit so the contract is honest.
const LIMITS = {
  title: 60,
  currentStep: 40,
  nextStep: 40,
  statusText: 24,
} as const;

function fail(field: string, message: string): never {
  throw new HttpError(400, "validation", message, field);
}

function checkText(field: keyof typeof LIMITS, value: unknown, required: boolean): void {
  if (value === undefined || value === null) {
    if (required) fail(field, `${field} is required.`);
    return;
  }
  if (typeof value !== "string") fail(field, `${field} must be a string.`);
  if ((value as string).length > LIMITS[field]) {
    fail(field, `${field} exceeds the ${LIMITS[field]}-character limit.`);
  }
}

/**
 * Validates a Journey payload against the template type and the §4.4/§4.6 rules. On any failure it
 * throws an HttpError(400) carrying the offending `field` and an actionable message; the route turns
 * that into a `400 {field,message}` response and a `reject` log. Returns the typed payload on success.
 *
 * M1 validates Journey only; Countdown/Progress validators arrive in M2.
 */
export function validateJourneyPayload(
  payload: unknown,
  templateType: TemplateType,
): JourneyPayload {
  if (typeof payload !== "object" || payload === null) {
    fail("payload", "payload must be an object.");
  }
  const p = payload as Record<string, unknown>;

  if (p.type !== templateType) {
    fail("type", `payload.type (${String(p.type)}) does not match the template type (${templateType}).`);
  }
  if (p.type !== "journey") {
    fail("type", `Only the journey template is supported in M1 (got ${String(p.type)}).`);
  }

  checkText("title", p.title, true);
  checkText("currentStep", p.currentStep, true);
  checkText("nextStep", p.nextStep, false);
  checkText("statusText", p.statusText, false);

  if (p.progress !== undefined && p.progress !== null) {
    if (typeof p.progress !== "number" || Number.isNaN(p.progress)) {
      fail("progress", "progress must be a number.");
    }
    if (p.progress < 0 || p.progress > 1) {
      fail("progress", `progress out of range (${p.progress}); must be between 0 and 1.`);
    }
  }

  if (p.targetDate !== undefined && p.targetDate !== null) {
    if (typeof p.targetDate !== "string" || Number.isNaN(Date.parse(p.targetDate))) {
      fail("targetDate", "targetDate must be an ISO-8601 date string.");
    }
  }

  return normalizeJourney(p);
}

/** Strips unknown keys and coerces optionals to a clean JourneyPayload for storage. */
function normalizeJourney(p: Record<string, unknown>): JourneyPayload {
  return {
    type: "journey",
    title: p.title as string,
    currentStep: p.currentStep as string,
    nextStep: (p.nextStep as string | undefined) ?? null,
    progress: (p.progress as number | undefined) ?? null,
    targetDate: (p.targetDate as string | undefined) ?? null,
    statusText: (p.statusText as string | undefined) ?? null,
  };
}

/** Dispatch point so M2 can add countdown/progress without touching the routes. */
export function validatePayload(payload: unknown, templateType: TemplateType): TemplatePayload {
  return validateJourneyPayload(payload, templateType);
}
