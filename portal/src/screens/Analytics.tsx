import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  getSummary,
  getTemplateInsights,
  getTimeseries,
  InsightsApiError,
  NoServiceKeyError,
  TIMESERIES_METRICS,
  type InsightsSummary,
  type Rate,
  type TimeseriesResponse,
} from "../insights";
import { listTemplates } from "../api";

// The analytics dashboard (build spec §10, design §09) - the console centerpiece. It reads the
// service-gated Insights API and shows the four hero metrics next to their raw numerator/denominator,
// a per-day time-series chart, and supporting totals. All labels obey the honest-naming rules:
// interactions/opens (not views), installations (not people), acknowledged latency, update-rejection
// rate (not "error rate"). The secondary lateApplicationRate is shown apart from the heroes and is
// explicitly not proof of what a user saw. A zero-denominator rate reads "n/a" with a worded reason,
// never 0% or a bare 0/0.

/** A date input value (YYYY-MM-DD) -> a UTC instant at the start of that day. */
function dayStartIso(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toISOString();
}

/** YYYY-MM-DD for `daysFromNow` days from today (UTC), for the date inputs. */
function dayString(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function pct(r: Rate): string {
  return r.rate === null ? "n/a" : `${(r.rate * 100).toFixed(1)}%`;
}

/** Latency in ms shown as seconds when >= 1s, else ms; null -> n/a. */
function latency(ms: number | null): string {
  if (ms === null) return "n/a";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function Analytics() {
  // Default to the last 7 days. The range is half-open [from, to): `to` is exclusive, so the default
  // `to` is tomorrow's start to include everything up to now.
  const [from, setFrom] = useState(dayString(-7));
  const [to, setTo] = useState(dayString(1));
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsKey(false);
    try {
      const data = await getSummary(dayStartIso(from), dayStartIso(to));
      setSummary(data);
    } catch (e) {
      setSummary(null);
      if (e instanceof NoServiceKeyError) {
        setNeedsKey(true);
        setError(e.message);
      } else if (e instanceof InsightsApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const latencyHero = summary?.heroes.acknowledgedSyncLatencyMs;

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="range-bar">
          <div>
            <label>From (inclusive)</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>To (exclusive)</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="ghost" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <span className="muted">Range is half-open [from, to). All metrics read the Insights API.</span>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="error">{error}</div>
          {needsKey && (
            <div className="muted" style={{ marginTop: 8 }}>
              The dashboard calls the service-gated Insights API. Set VITE_SERVICE_KEY (the seeded
              service key from backend/.seeded-keys.json) or generate one on the Projects &amp; keys
              screen.
            </div>
          )}
        </div>
      )}

      {summary && latencyHero && (
        <>
          <div className="heroes">
            <Hero
              tone="green"
              label="Apply-success rate"
              value={pct(summary.heroes.applySuccessRate)}
              detail={
                summary.heroes.applySuccessRate.denominator === 0
                  ? "No accepted post-start updates yet."
                  : `${summary.heroes.applySuccessRate.numerator} / ${summary.heroes.applySuccessRate.denominator} accepted post-start updates acknowledged`
              }
            />
            <Hero
              tone="indigo"
              label="Acknowledged sync latency (median)"
              value={latencyHero.count === 0 ? "n/a" : latency(latencyHero.medianMs)}
              detail={
                latencyHero.count === 0
                  ? "No acknowledgements yet."
                  : `avg ${latency(latencyHero.averageMs)} · ${latencyHero.count} acks · server-clock, includes upload delay`
              }
            />
            <Hero
              tone="blue"
              label="Interaction rate"
              value={pct(summary.heroes.interactionRate)}
              detail={
                summary.heroes.interactionRate.denominator === 0
                  ? "No sessions started in this range."
                  : `${summary.heroes.interactionRate.numerator} / ${summary.heroes.interactionRate.denominator} started sessions with an open or expanded-action tap`
              }
            />
            <Hero
              tone="plain"
              label="Update-rejection rate"
              value={pct(summary.heroes.updateRejectionRate)}
              detail={
                summary.heroes.updateRejectionRate.denominator === 0
                  ? "No post-start update attempts yet."
                  : `${summary.heroes.updateRejectionRate.numerator} rejected / ${summary.heroes.updateRejectionRate.denominator} post-start update attempts`
              }
            />
          </div>

          <div className="card secondary-card">
            <div className="row">
              <div>
                <span className="secondary-tag">secondary</span>
                <span className="secondary-label">Late-application rate</span>
              </div>
              <b>{pct(summary.secondary.lateApplicationRate)}</b>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              {summary.secondary.lateApplicationRate.denominator === 0
                ? "No deadline-eligible post-start updates yet. "
                : `${summary.secondary.lateApplicationRate.numerator} / ${summary.secondary.lateApplicationRate.denominator} deadline-eligible post-start updates with no timely ack. `}
              This means the server did not get a timely acknowledgement - it is not proof of what the
              user saw.
            </div>
          </div>

          <TimeSeries from={dayStartIso(from)} to={dayStartIso(to)} />

          <TemplateComparison projectId={summary.projectId} from={dayStartIso(from)} to={dayStartIso(to)} />

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Totals for the range</h2>
            <div className="totals">
              <Total label="Sessions started" value={summary.totals.sessionsStarted} />
              <Total label="Sessions ended" value={summary.totals.sessionsEnded} />
              <Total label="Opens" value={summary.totals.opens} />
              <Total label="Expanded-action taps" value={summary.totals.expandedActionTaps} />
              <Total
                label="Updates / session"
                value={summary.totals.updatesPerSession === null ? "n/a" : summary.totals.updatesPerSession.toFixed(2)}
              />
              <Total label="Unique installations" value={summary.totals.uniqueInstallations} />
              <Total label="Accepted updates" value={summary.totals.acceptedUpdates} />
              <Total label="Rejected updates" value={summary.totals.rejectedUpdates} />
              <Total label="Update attempts" value={summary.totals.updateAttempts} />
              <Total label="Sync failures" value={summary.totals.syncFailures} />
            </div>
            <div className="muted" style={{ marginTop: 12 }}>
              Unique installations counts anonymous per-install ids, never people or users. Sync
              failures are a separate count, not folded into the update-rejection rate.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// The per-day time-series chart. It reads /v1/insights/timeseries, which serves daily_metrics rows
// only (never the cohort-aligned range heroes), so the daily rate/latency variants are operational,
// not the hero of the same name; the endpoint's `note` is shown verbatim to keep that honest.
function TimeSeries(props: { from: string; to: string }) {
  const [metric, setMetric] = useState("sessionsStarted");
  const [data, setData] = useState<TimeseriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTimeseries(metric, props.from, props.to)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metric, props.from, props.to]);

  const isRate = data?.kind === "rate";
  const isLatency = data?.kind === "latency";
  const points = data?.series ?? [];
  const max = points.reduce((m, p) => Math.max(m, p.value ?? 0), 0);

  function fmtValue(p: { value: number | null }): string {
    if (p.value === null) return "n/a";
    if (isRate) return `${(p.value * 100).toFixed(1)}%`;
    if (isLatency) return latency(p.value);
    return String(p.value);
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ alignItems: "center" }}>
        <h2>Daily time series</h2>
        <select className="metric-select" value={metric} onChange={(e) => setMetric(e.target.value)}>
          {TIMESERIES_METRICS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {data?.note && <div className="muted" style={{ marginBottom: 8 }}>{data.note}</div>}
      {error && <div className="error">{error}</div>}
      {!error && !loading && points.length === 0 && (
        <div className="muted">No data for this metric in the selected range.</div>
      )}

      {points.length > 0 && (
        <div className="chart">
          {points.map((p) => {
            const h = max > 0 && p.value !== null ? Math.max(4, (p.value / max) * 100) : 0;
            const sub =
              isRate && p.numerator !== undefined ? ` (${p.numerator}/${p.denominator})` : "";
            return (
              <div className="chart-col" key={p.date} title={`${p.date}: ${fmtValue(p)}${sub}`}>
                <div className="chart-val">{fmtValue(p)}</div>
                <div className="chart-bar" style={{ height: `${h}%` }} />
                <div className="chart-date">{p.date.slice(5)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Template comparison: the same hero metrics scoped to each template. Templates are enumerated from
// the admin list (GET /v1/admin/templates), then queried via GET /v1/insights/templates/:id with the
// service key. A template that belongs to a different project than the service key resolves 404 and is
// simply skipped, so no cross-project data is ever shown.
interface TemplateRow {
  templateId: string;
  summary: InsightsSummary;
}

function TemplateComparison(props: { projectId: string; from: string; to: string }) {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Scope enumeration to the dashboard's project (the service key's project) so we never query a
        // foreign-project template (which would 404). The 404 skip below stays as defense.
        const { templates } = await listTemplates(props.projectId);
        const ids = [...new Set(templates.map((t) => t.templateId))];
        const results: TemplateRow[] = [];
        for (const templateId of ids) {
          try {
            const summary = await getTemplateInsights(templateId, props.from, props.to);
            results.push({ templateId, summary });
          } catch (e) {
            // Skip templates outside the service key's project (404); surface other errors once.
            if (!(e instanceof InsightsApiError && e.status === 404)) throw e;
          }
        }
        if (!cancelled) setRows(results);
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.projectId, props.from, props.to]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>By template</h2>
      {error && <div className="error">{error}</div>}
      {!error && !loading && rows.length === 0 && (
        <div className="muted">No templates resolved for this service key's project.</div>
      )}
      {rows.length > 0 && (
        <table className="cmp">
          <thead>
            <tr>
              <th>Template</th>
              <th>Sessions started</th>
              <th>Apply-success</th>
              <th>Interaction</th>
              <th>Update-rejection</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.templateId}>
                <td className="sid">{r.templateId}</td>
                <td>{r.summary.totals.sessionsStarted}</td>
                <td>{pct(r.summary.heroes.applySuccessRate)}</td>
                <td>{pct(r.summary.heroes.interactionRate)}</td>
                <td>{pct(r.summary.heroes.updateRejectionRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Hero(props: { tone: "green" | "indigo" | "blue" | "plain"; label: string; value: string; detail: string }) {
  return (
    <div className={`hero hero-${props.tone}`}>
      <div className="hero-label">{props.label}</div>
      <div className="hero-value">{props.value}</div>
      <div className="hero-detail">{props.detail}</div>
    </div>
  );
}

function Total(props: { label: string; value: ReactNode }) {
  return (
    <div className="total">
      <div className="total-value">{props.value}</div>
      <div className="total-label">{props.label}</div>
    </div>
  );
}
