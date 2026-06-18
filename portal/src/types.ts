// Mirrors the slice of the backend contract the portal needs (build spec §4, §8.3).

export interface AdminSession {
  sessionId: string;
  templateId: string;
  type: string;
  status: "active" | "ended";
  version: number;
  lastUpdatedAt: string;
  startedAt: string;
  deepLinkURL: string;
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
}

/** The backend's 400 error shape: { error, message, field }. */
export interface ApiError {
  error: string;
  message: string;
  field?: string;
}
