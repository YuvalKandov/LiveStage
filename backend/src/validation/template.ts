import { HttpError } from "../util";
import { ACCENT_STYLES, ICON_ALLOWLIST, type AccentStyle, type TemplateType } from "../models";
import { checkText } from "./common";

// Validation for authoring templates from the portal (build spec §4.4, §4.5, §8.4). The icon must be
// on the SF Symbol allowlist and the accent in the fixed palette - the same constraints the renderer
// and the design doc lock - so a template can never carry an arbitrary symbol or off-palette color.
// zeroStateLabel is handled as an internal field: it is parsed out of `labels` here and stored in the
// `zero_state_label` column; the repo folds it back into `labels.zeroStateLabel` on read.

const TEMPLATE_TYPES: TemplateType[] = ["journey", "countdown", "progress"];
const LABEL_KEYS = ["nextStepLabel", "targetLabel", "countdownLabel", "completionLabel"] as const;
const LABEL_MAX = 24; // labels are short qualifiers ("Next", "Boarding in"); keep them tight

export interface ValidatedTemplate {
  templateId: string;
  type: TemplateType;
  displayName: string;
  icon: string;
  accent: AccentStyle;
  deepLinkBase: string;
  labelsJson: string; // the label map WITHOUT zeroStateLabel (stored as-is)
  zeroStateLabel: string | null; // internal column; folded into labels.zeroStateLabel on read
  staleAfterSeconds: number;
}

function fail(field: string, message: string): never {
  throw new HttpError(400, "validation", message, field);
}

function requireString(field: string, value: unknown, max: number): string {
  if (typeof value !== "string" || value.trim() === "") fail(field, `${field} is required.`);
  const v = (value as string).trim();
  if (v.length > max) fail(field, `${field} exceeds the ${max}-character limit.`);
  return v;
}

/** Validates a full template authoring payload (used for create, and for the merged PATCH result). */
export function validateTemplate(input: unknown): ValidatedTemplate {
  const body = (input ?? {}) as Record<string, unknown>;

  const templateId = requireString("templateId", body.templateId, 60);
  if (!/^[A-Za-z0-9._-]+$/.test(templateId)) {
    fail("templateId", "templateId may contain only letters, numbers, dot, dash and underscore.");
  }

  if (typeof body.type !== "string" || !TEMPLATE_TYPES.includes(body.type as TemplateType)) {
    fail("type", `type must be one of ${TEMPLATE_TYPES.join(", ")}.`);
  }
  const type = body.type as TemplateType;

  // displayName reuses the shared §4.6 length limit (40).
  checkText("displayName", body.displayName, true);
  const displayName = (body.displayName as string).trim();

  if (typeof body.icon !== "string" || !ICON_ALLOWLIST.includes(body.icon)) {
    fail("icon", `icon must be one of the allowlist: ${ICON_ALLOWLIST.join(", ")}.`);
  }
  const icon = body.icon as string;

  if (typeof body.accent !== "string" || !ACCENT_STYLES.includes(body.accent as AccentStyle)) {
    fail("accent", `accent must be one of ${ACCENT_STYLES.join(", ")}.`);
  }
  const accent = body.accent as AccentStyle;

  const deepLinkBase = requireString("deepLinkBase", body.deepLinkBase, 120);
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(deepLinkBase)) {
    fail("deepLinkBase", "deepLinkBase must be a URL with a scheme (e.g. triptogether://trip).");
  }

  // Labels: keep only the known keys, each an optional short string. zeroStateLabel is pulled out and
  // stored separately (the internal column), so it never lives inside labels_json.
  const rawLabels = (body.labels ?? {}) as Record<string, unknown>;
  const labels: Record<string, string> = {};
  for (const key of LABEL_KEYS) {
    const value = rawLabels[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") fail(key, `${key} must be a string.`);
    if ((value as string).length > LABEL_MAX) fail(key, `${key} exceeds the ${LABEL_MAX}-character limit.`);
    labels[key] = value as string;
  }

  let zeroStateLabel: string | null = null;
  const zsl = rawLabels.zeroStateLabel;
  if (zsl !== undefined && zsl !== null && zsl !== "") {
    if (typeof zsl !== "string") fail("zeroStateLabel", "zeroStateLabel must be a string.");
    if ((zsl as string).length > LABEL_MAX) fail("zeroStateLabel", `zeroStateLabel exceeds the ${LABEL_MAX}-character limit.`);
    zeroStateLabel = zsl as string;
  }

  let staleAfterSeconds = 900;
  if (body.staleAfterSeconds !== undefined && body.staleAfterSeconds !== null) {
    const n = body.staleAfterSeconds;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 30 || n > 86_400) {
      fail("staleAfterSeconds", "staleAfterSeconds must be an integer between 30 and 86400.");
    }
    staleAfterSeconds = n as number;
  }

  return {
    templateId,
    type,
    displayName,
    icon,
    accent,
    deepLinkBase,
    labelsJson: JSON.stringify(labels),
    zeroStateLabel,
    staleAfterSeconds,
  };
}
