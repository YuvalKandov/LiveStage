import type { JourneyPayload, TemplateType } from "../models";
import { checkInstant, checkProgress, checkText, fail } from "./common";

/**
 * Validates a Journey payload against the template type and the §4.4/§4.6 rules. On any failure it
 * throws an HttpError(400) carrying the offending `field` and an actionable message; the route turns
 * that into a `400 {field,message}` response and a `reject` log. Returns the typed payload on success.
 */
export function validateJourneyPayload(payload: unknown, templateType: TemplateType): JourneyPayload {
  if (typeof payload !== "object" || payload === null) fail("payload", "payload must be an object.");
  const p = payload as Record<string, unknown>;

  if (p.type !== templateType) {
    fail("type", `payload.type (${String(p.type)}) does not match the template type (${templateType}).`);
  }
  if (p.type !== "journey") fail("type", `Expected a journey payload (got ${String(p.type)}).`);

  checkText("title", p.title, true);
  checkText("currentStep", p.currentStep, true);
  checkText("nextStep", p.nextStep, false);
  checkText("statusText", p.statusText, false);
  checkProgress(p.progress, false);
  checkInstant("targetDate", p.targetDate, false);

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
