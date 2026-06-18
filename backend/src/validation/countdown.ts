import type { CountdownPayload, TemplateType } from "../models";
import { checkInstant, checkText, fail } from "./common";

/**
 * Validates a Countdown payload (design §05). `targetDate` is required and must be a strict
 * timezone-aware ISO-8601 instant — it is the template's whole purpose. On failure throws
 * HttpError(400) with the offending field; returns the normalized payload on success.
 */
export function validateCountdownPayload(payload: unknown, templateType: TemplateType): CountdownPayload {
  if (typeof payload !== "object" || payload === null) fail("payload", "payload must be an object.");
  const p = payload as Record<string, unknown>;

  if (p.type !== templateType) {
    fail("type", `payload.type (${String(p.type)}) does not match the template type (${templateType}).`);
  }
  if (p.type !== "countdown") fail("type", `Expected a countdown payload (got ${String(p.type)}).`);

  checkText("title", p.title, true);
  checkText("subtitle", p.subtitle, false);
  checkText("statusText", p.statusText, false);
  checkText("location", p.location, false);
  checkInstant("targetDate", p.targetDate, true);

  return {
    type: "countdown",
    title: p.title as string,
    subtitle: (p.subtitle as string | undefined) ?? null,
    targetDate: p.targetDate as string,
    statusText: (p.statusText as string | undefined) ?? null,
    location: (p.location as string | undefined) ?? null,
  };
}
