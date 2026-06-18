import { HttpError } from "../util";
import type { TemplatePayload, TemplateType } from "../models";
import { validateJourneyPayload } from "./journey";
import { validateCountdownPayload } from "./countdown";
import { validateProgressPayload } from "./progress";

/**
 * Dispatches payload validation by the session/template type, so the routes stay template-agnostic
 * (build spec §8.4). Each branch validates against §4.4/§4.6 and returns the normalized payload, or
 * throws HttpError(400) with the offending field.
 */
export function validatePayload(payload: unknown, templateType: TemplateType): TemplatePayload {
  switch (templateType) {
    case "journey":
      return validateJourneyPayload(payload, templateType);
    case "countdown":
      return validateCountdownPayload(payload, templateType);
    case "progress":
      return validateProgressPayload(payload, templateType);
    default:
      throw new HttpError(400, "unsupported_template", `Unsupported template type: ${String(templateType)}.`);
  }
}
