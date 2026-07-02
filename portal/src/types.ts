// Mirrors the slice of the backend contract the portal needs (build spec §4, §8.3).

/** The frozen start-time attributes the admin list carries so a running activity can be previewed
 *  faithfully (a later template edit never changes a running activity's look). */
export interface AdminSessionAttributes {
  iconIdentifier: string | null;
  accentStyle: string | null;
  labels: TemplateLabels;
}

export interface AdminSession {
  sessionId: string;
  templateId: string;
  type: string;
  status: "active" | "ended";
  version: number;
  lastUpdatedAt: string;
  startedAt: string;
  deepLinkURL: string;
  state: { payload: TemplatePayload; metadata: { lastUpdatedAt: string; version: number } };
  attributes: AdminSessionAttributes;
}

export interface JourneyPayload {
  type: "journey";
  title: string;
  currentStep: string;
  nextStep?: string | null;
  progress?: number | null;
  statusText?: string | null;
  targetDate?: string | null;
}

export interface CountdownPayload {
  type: "countdown";
  title: string;
  subtitle?: string | null;
  targetDate: string; // ISO-8601, required (tz-aware)
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

export interface UpdateResult {
  version: number;
  lastUpdatedAt: string;
}

export interface LogRow {
  id: number;
  session_id: string | null;
  kind: string;
  detail: string | null;
  status: string;
  created_at: string;
  // Joined from the session so a row identifies what activity it was (identifiers only, no content).
  template_id?: string | null;
  type?: string | null;
}

/** The backend's 400 error shape: { error, message, field }. */
export interface ApiError {
  error: string;
  message: string;
  field?: string;
}

export type KeyType = "mobile" | "service";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

/** Key metadata from the listing - never carries the secret (build spec §12). */
export interface ApiKeyMeta {
  id: string;
  projectId: string;
  keyType: KeyType;
  label: string;
  revoked: boolean;
  createdAt: string;
}

/** The create response, which carries the raw key exactly once (`key`). */
export interface CreatedApiKey extends ApiKeyMeta {
  key: string;
}

export type TemplateType = "journey" | "countdown" | "progress";
export type AccentStyle = "blue" | "orange" | "green" | "indigo" | "teal";

/** The icon allowlist + accent palette the backend validates against (build spec §4.5). */
export const ICON_ALLOWLIST = ["airplane", "clock", "shippingbox", "mappin", "bag", "car", "bell"];
export const ACCENT_STYLES: AccentStyle[] = ["blue", "orange", "green", "indigo", "teal"];

export interface TemplateLabels {
  nextStepLabel?: string | null;
  targetLabel?: string | null;
  countdownLabel?: string | null;
  completionLabel?: string | null;
  zeroStateLabel?: string | null; // countdown only; folded from the internal column on read
}

export interface TemplateConfig {
  id: string;
  projectId: string;
  templateId: string;
  type: TemplateType;
  displayName: string;
  icon: string;
  accent: AccentStyle;
  deepLinkBase: string;
  labels: TemplateLabels;
  staleAfterSeconds: number;
}
