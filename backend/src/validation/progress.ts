import type { ProgressPayload, TemplateType } from "../models";
import { checkInstant, checkProgress, checkText, fail } from "./common";

/**
 * Validates a Progress payload (design §06). `progress` is required and must be in [0, 1] — it is
 * the field that drives every surface. On failure throws HttpError(400) with the offending field;
 * returns the normalized payload on success.
 */
export function validateProgressPayload(payload: unknown, templateType: TemplateType): ProgressPayload {
  if (typeof payload !== "object" || payload === null) fail("payload", "payload must be an object.");
  const p = payload as Record<string, unknown>;

  if (p.type !== templateType) {
    fail("type", `payload.type (${String(p.type)}) does not match the template type (${templateType}).`);
  }
  if (p.type !== "progress") fail("type", `Expected a progress payload (got ${String(p.type)}).`);

  checkText("title", p.title, true);
  checkText("currentStage", p.currentStage, false);
  checkText("detailText", p.detailText, false);
  checkProgress(p.progress, true);
  checkInstant("estimatedCompletionDate", p.estimatedCompletionDate, false);

  return {
    type: "progress",
    title: p.title as string,
    currentStage: (p.currentStage as string | undefined) ?? null,
    progress: p.progress as number,
    estimatedCompletionDate: (p.estimatedCompletionDate as string | undefined) ?? null,
    detailText: (p.detailText as string | undefined) ?? null,
  };
}
