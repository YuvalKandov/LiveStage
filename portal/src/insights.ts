import { API_BASE, activeServiceKey } from "./config";

// Client for the developer-facing Insights API (build spec §8.3/§8.6). These routes are service-key
// gated: a missing key is 401, a mobile key is 403. The dashboard sends the active service key as a
// Bearer token, so it is just another client of the same API the developer could curl directly.

/** A rate returned next to its raw numerator/denominator (build spec §8.6 - auditable from curl). */
export interface Rate {
  rate: number | null; // null when the denominator is 0 (never 0/0)
  numerator: number;
  denominator: number;
}

export interface AcknowledgedSyncLatency {
  averageMs: number | null;
  medianMs: number | null; // from raw applied_latencies, never an average of daily averages
  count: number;
}

export interface InsightsSummary {
  projectId: string;
  range: { from: string; to: string; evaluationTime: string; templateId: string | null };
  heroes: {
    applySuccessRate: Rate;
    acknowledgedSyncLatencyMs: AcknowledgedSyncLatency;
    interactionRate: Rate;
    updateRejectionRate: Rate;
  };
  secondary: { lateApplicationRate: Rate };
  totals: {
    sessionsStarted: number;
    sessionsEnded: number;
    opens: number;
    expandedActionTaps: number;
    uniqueInstallations: number;
    updatesApplied: number;
    updatesPerSession: number | null;
    acceptedUpdates: number;
    rejectedUpdates: number;
    updateAttempts: number;
    syncFailures: number;
  };
}

/** Thrown when no service key is configured (so the UI can prompt instead of sending an empty key). */
export class NoServiceKeyError extends Error {
  constructor() {
    super("No service key configured. Add one on the Projects & keys screen, or set VITE_SERVICE_KEY.");
    this.name = "NoServiceKeyError";
  }
}

/** Carries the Insights API's structured error so the UI can explain a 401/403 plainly. */
export class InsightsApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "InsightsApiError";
  }
}

async function insightsFetch<T>(path: string): Promise<T> {
  const key = activeServiceKey();
  if (!key) throw new NoServiceKeyError();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  } catch (e) {
    throw new InsightsApiError(0, `Cannot reach the backend (${e instanceof Error ? e.message : String(e)}).`);
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    // The Insights routes reject a mobile key with 403 and a missing/bad key with 401; surface the
    // distinction honestly rather than collapsing both into one message.
    const detail = (json as { message?: string }).message ?? res.statusText;
    if (res.status === 403) {
      throw new InsightsApiError(403, `Insights rejected this key (403). The dashboard needs a service key, not a mobile key. ${detail}`);
    }
    if (res.status === 401) {
      throw new InsightsApiError(401, `Insights auth failed (401). Check the service key. ${detail}`);
    }
    throw new InsightsApiError(res.status, detail);
  }
  return json as T;
}

/** GET /v1/insights/summary?from&to - the four hero metrics + supporting totals for the range. */
export function getSummary(from: string, to: string): Promise<InsightsSummary> {
  const q = new URLSearchParams({ from, to });
  return insightsFetch(`/v1/insights/summary?${q.toString()}`);
}

// --- Time-series (build spec §8.6) ---------------------------------------------------------------
// GET /v1/insights/timeseries returns PER-DAY rows from daily_metrics only (never the cohort-aligned
// range heroes). A count metric row is { date, value }; a rate/latency row also carries its
// numerator/denominator (a zero denominator yields a null value, never 0/0). The endpoint attaches a
// `note` on the rate/latency metrics that are daily/operational rather than the range hero - we show
// it verbatim so the distinction stays honest.

export type TimeseriesKind = "count" | "rate" | "latency";

export interface TimeseriesPoint {
  date: string; // YYYY-MM-DD
  value: number | null;
  numerator?: number;
  denominator?: number;
}

export interface TimeseriesResponse {
  metric: string;
  kind: TimeseriesKind;
  interval: "day";
  note?: string;
  range: { from: string; to: string; templateId: string | null };
  series: TimeseriesPoint[];
}

/** The metrics the timeseries endpoint supports, with display labels and their kind for the chart. */
export interface MetricOption {
  id: string;
  label: string;
  kind: TimeseriesKind;
}

export const TIMESERIES_METRICS: MetricOption[] = [
  { id: "sessionsStarted", label: "Sessions started", kind: "count" },
  { id: "sessionsEnded", label: "Sessions ended", kind: "count" },
  { id: "opens", label: "Opens", kind: "count" },
  { id: "expandedActionTaps", label: "Expanded-action taps", kind: "count" },
  { id: "updatesApplied", label: "Updates applied", kind: "count" },
  { id: "updateAttempts", label: "Update attempts", kind: "count" },
  { id: "acceptedUpdates", label: "Accepted updates", kind: "count" },
  { id: "rejectedUpdates", label: "Rejected updates", kind: "count" },
  { id: "sessionsWithInteraction", label: "Sessions with interaction", kind: "count" },
  { id: "errors", label: "Client-reported errors", kind: "count" },
  { id: "updateRejectionRate", label: "Update-rejection rate (daily)", kind: "rate" },
  { id: "applySuccessRate", label: "Apply-success rate (daily)", kind: "rate" },
  { id: "interactionRate", label: "Interaction rate (daily)", kind: "rate" },
  { id: "averageLatencyMs", label: "Average sync latency (daily)", kind: "latency" },
];

/** GET /v1/insights/timeseries?metric&from&to&interval=day - per-day chart rows for one metric. */
export function getTimeseries(metric: string, from: string, to: string): Promise<TimeseriesResponse> {
  const q = new URLSearchParams({ metric, from, to, interval: "day" });
  return insightsFetch(`/v1/insights/timeseries?${q.toString()}`);
}

// --- Session timeline (the session explorer, build spec §8.3) ------------------------------------
// GET /v1/insights/sessions/:id returns one session's event history. It is CONTENT-FREE by contract
// (§4.8): only identifiers, event types, versions, timestamps, and metadata filtered to source/reason
// - never any Live Activity state (no titles, locations, status text). The portal renders exactly
// those fields and nothing else.

export interface TimelineEvent {
  eventId: string;
  eventType: string;
  templateId: string;
  occurredAt: string; // device/event time - for the timeline display only (clock skew)
  receivedAt: string; // server ingest time
  version?: number; // for state_applied: which version was applied
  metadata?: { source?: string; reason?: string };
  latencyMs?: number; // for state_applied: server-clock acknowledged latency (T2 - T1)
}

export interface SessionTimeline {
  sessionId: string;
  templateId: string;
  type: string;
  status: string; // lifecycle (active|ended), not user content
  startedAt: string;
  endedAt: string | null;
  events: TimelineEvent[];
}

/** GET /v1/insights/sessions/:sessionId - one session's content-free event timeline. */
export function getSessionTimeline(sessionId: string): Promise<SessionTimeline> {
  return insightsFetch(`/v1/insights/sessions/${encodeURIComponent(sessionId)}`);
}

/** GET /v1/insights/templates/:templateId?from&to - the same summary shape scoped to one template. */
export function getTemplateInsights(templateId: string, from: string, to: string): Promise<InsightsSummary> {
  const q = new URLSearchParams({ from, to });
  return insightsFetch(`/v1/insights/templates/${encodeURIComponent(templateId)}?${q.toString()}`);
}
