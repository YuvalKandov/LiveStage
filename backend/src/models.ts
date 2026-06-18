// TypeScript mirror of the LiveStage data contract (build spec §4). These types define the
// canonical wire schema the Swift SDK and this backend agree on: a flattened, `type`-discriminated
// payload, ISO-8601 dates, and the field names below. The Swift side lives in LiveStageModels.

export type TemplateType = "journey" | "countdown" | "progress";
export type AccentStyle = "blue" | "orange" | "green" | "indigo" | "teal";

export const ACCENT_STYLES: AccentStyle[] = ["blue", "orange", "green", "indigo", "teal"];
// Allowlist of SF Symbol identifiers (build spec §4.5). Validation rejects names outside it.
export const ICON_ALLOWLIST = ["airplane", "clock", "shippingbox", "mappin", "bag", "car", "bell"];

export interface TemplateLabels {
  nextStepLabel?: string | null;
  targetLabel?: string | null;
  countdownLabel?: string | null;
  completionLabel?: string | null;
  // Countdown only: the zero label, single source of truth. The repo folds the `zero_state_label`
  // DB column into here so the renderer (which only sees attributes) can reach it.
  zeroStateLabel?: string | null;
}

export interface TemplateConfiguration {
  templateId: string;
  templateType: TemplateType;
  displayName: string;
  icon: string;
  accentStyle: AccentStyle;
  deepLinkBase: string;
  labels: TemplateLabels;
  staleAfterSeconds: number;
}

// Flattened payload: the `type` discriminator sits beside the state's own fields (build spec §4.7).
export interface JourneyPayload {
  type: "journey";
  title: string;
  currentStep: string;
  nextStep?: string | null;
  progress?: number | null;
  targetDate?: string | null; // ISO-8601
  statusText?: string | null;
}

export interface CountdownPayload {
  type: "countdown";
  title: string;
  subtitle?: string | null;
  targetDate: string; // ISO-8601, required
  statusText?: string | null;
  location?: string | null;
}

export interface ProgressPayload {
  type: "progress";
  title: string;
  currentStage?: string | null;
  progress: number; // required, 0..1
  estimatedCompletionDate?: string | null;
  detailText?: string | null;
}

export type TemplatePayload = JourneyPayload | CountdownPayload | ProgressPayload;

export interface StateMetadata {
  lastUpdatedAt: string; // ISO-8601, server-authored
  version: number;
}

// The complete content state returned by poll/update responses (payload + server-authored metadata).
export interface LiveStageContentState {
  payload: TemplatePayload;
  metadata: StateMetadata;
}

export type LifecycleStatus = "active" | "ended";

/** Builds the renderer-only attributes that are frozen into `attributes_json` at start (§4.1). */
export interface ActivityAttributes {
  sessionId: string;
  templateId: string;
  templateType: TemplateType;
  iconIdentifier: string;
  accentStyle: AccentStyle;
  labels: TemplateLabels;
  deepLinkURL: string;
}
