import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { KeyRound } from "lucide-react";
import { listTemplates } from "../api";
import { PageHeader } from "../components/PageHeader";
import { SERVICE_KEY_STORAGE, activeServiceKey } from "../config";

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

/** Round x up to the nearest 1/2/5 x 10^n (works for fractions too, e.g. rates). */
function niceCeil(x: number): number {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  const f = x / base;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * base;
}

export function Analytics() {
  // Default to the last 7 days. The range is half-open [from, to): `to` is exclusive, so the default
  // `to` is tomorrow's start to include everything up to now.
  const [from, setFrom] = useState(dayString(-7));
  const [to, setTo] = useState(dayString(1));
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyProblem, setKeyProblem] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setKeyProblem(false);
    try {
      const data = await getSummary(dayStartIso(from), dayStartIso(to));
      setSummary(data);
    } catch (e) {
      setSummary(null);
      if (e instanceof NoServiceKeyError) {
        // No key at all.
        setKeyProblem(true);
        setError(e.message);
      } else if (e instanceof InsightsApiError) {
        // A 401 (unknown/revoked key) or 403 (a mobile key) is also fixable by setting a good key.
        if (e.status === 401 || e.status === 403) setKeyProblem(true);
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
      <PageHeader
        title="Analytics"
        subtitle="Hero metrics, daily trends, and supporting totals from the Insights API."
      />
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

      {error && keyProblem && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          <KeyRound size={28} strokeWidth={1.75} aria-hidden />
          <div className="empty-title">Connect a service key to see analytics</div>
          <div className="empty-sub">{error}</div>
          <ServiceKeyControl onSaved={load} />
        </div>
      )}

      {error && !keyProblem && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="error">{error}</div>
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
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);

  // Measure the chart container so the SVG fills the card width and reflows on resize.
  const roRef = useRef<ResizeObserver | null>(null);
  const setWrap = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!node) return;
    setWidth(node.clientWidth || 640);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(node);
    roRef.current = ro;
  }, []);

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

  function fmtValue(p: { value: number | null }): string {
    if (p.value === null) return "n/a";
    if (isRate) return `${(p.value * 100).toFixed(1)}%`;
    if (isLatency) return latency(p.value);
    return String(p.value);
  }

  // Responsive geometry: the SVG fills the card width (no fixed-width slab, no dead space) and the
  // bars are distributed across it. A single day renders as one centered bar, not a full-width block.
  const PAD = { left: 44, right: 16, top: 12, bottom: 26 };
  const PLOT_H = 176;
  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const slot = points.length > 0 ? plotW / points.length : plotW;
  const barW = Math.max(6, Math.min(34, slot * 0.55));
  // Themeable via CSS vars (SVG fill accepts var()); matches the hero color-coding by metric kind.
  const barColor = isRate ? "var(--success)" : isLatency ? "var(--indigo)" : "var(--accent)";

  // A tight "nice" axis: round the max up to a clean step (whole numbers for counts) so the tallest
  // bar nearly reaches the top instead of floating under a lot of empty headroom. Rates cap at 100%.
  const rawMax = points.reduce((m, p) => Math.max(m, p.value ?? 0), 0);
  let step: number;
  let axisMax: number;
  if (rawMax <= 0) {
    step = isRate ? 0.25 : 1;
    axisMax = 1;
  } else {
    let s = niceCeil(rawMax / 4);
    if (!isRate && !isLatency) s = Math.max(1, Math.ceil(s)); // counts get whole-number ticks
    step = s;
    axisMax = Math.ceil(rawMax / step) * step;
    if (isRate && axisMax > 1) {
      axisMax = 1;
      step = 0.25;
    }
  }
  const nSteps = Math.max(1, Math.round(axisMax / step));
  const ticks = Array.from({ length: nSteps + 1 }, (_, i) => i * step);

  function fmtAxis(v: number): string {
    if (isRate) return `${Math.round(v * 100)}%`;
    if (isLatency) return latency(v);
    return String(Math.round(v));
  }

  const svgH = PAD.top + PLOT_H + PAD.bottom;
  const baseY = PAD.top + PLOT_H;
  const yOf = (v: number) => baseY - (v / axisMax) * PLOT_H;
  const slotX = (i: number) => PAD.left + slot * i; // left edge of a column's slot
  const centerX = (i: number) => slotX(i) + slot / 2; // center of the slot (bar + label)

  // Thin the date labels so they do not overlap when the range is long.
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));

  // Group the metric options by kind so the long list reads as three short groups, not one flat 14.
  const metricGroups: { label: string; kind: "count" | "rate" | "latency" }[] = [
    { label: "Counts", kind: "count" },
    { label: "Rates", kind: "rate" },
    { label: "Latency", kind: "latency" },
  ];

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ alignItems: "center" }}>
        <h2>Daily time series</h2>
        <select className="metric-select" value={metric} onChange={(e) => setMetric(e.target.value)}>
          {metricGroups.map((g) => (
            <optgroup key={g.kind} label={g.label}>
              {TIMESERIES_METRICS.filter((m) => m.kind === g.kind).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {data?.note && <div className="muted" style={{ marginBottom: 8 }}>{data.note}</div>}
      {error && <div className="error">{error}</div>}

      {!error && (
        <div className="chart-wrap" ref={setWrap} onMouseLeave={() => setHover(null)}>
          {points.length === 0 ? (
            <div className="muted">
              {loading ? "Loading…" : "No data for this metric in the selected range."}
            </div>
          ) : (
            <svg className="chart-svg" width={width} height={svgH} role="img" aria-label="Daily time series">
              {/* Horizontal gridlines + y-axis value labels (formatted by metric kind). */}
              {ticks.map((t) => (
                <g key={t}>
                  <line className="chart-grid" x1={PAD.left} x2={PAD.left + plotW} y1={yOf(t)} y2={yOf(t)} />
                  <text className="chart-axis" x={PAD.left - 8} y={yOf(t) + 3} textAnchor="end">
                    {fmtAxis(t)}
                  </text>
                </g>
              ))}

              {points.map((p, i) => {
                const cx = centerX(i);
                const bx = cx - barW / 2;
                const sub = p.numerator !== undefined ? ` (${p.numerator}/${p.denominator})` : "";
                return (
                  <g key={p.date}>
                    {p.value === null ? null : p.value === 0 ? (
                      // A real zero day: a thin baseline marker so it is distinct from a missing day.
                      <rect className="chart-zero" x={bx} y={baseY - 2} width={barW} height={2} />
                    ) : (
                      <rect
                        x={bx}
                        y={yOf(p.value)}
                        width={barW}
                        height={Math.max(1, baseY - yOf(p.value))}
                        rx={3}
                        fill={barColor}
                        opacity={hover === null || hover === i ? 1 : 0.55}
                      />
                    )}
                    {i % labelEvery === 0 && (
                      <text className="chart-date" x={cx} y={baseY + 16} textAnchor="middle">
                        {p.date.slice(5)}
                      </text>
                    )}
                    {/* Full-height transparent hit area so hovering anywhere in the column shows the tip. */}
                    <rect
                      x={slotX(i)}
                      y={PAD.top}
                      width={slot}
                      height={PLOT_H}
                      fill="transparent"
                      onMouseEnter={() => setHover(i)}
                    >
                      <title>{`${p.date}: ${fmtValue(p)}${sub}`}</title>
                    </rect>
                  </g>
                );
              })}
            </svg>
          )}

          {hover !== null && points[hover] && (
            <div className="chart-tip" style={{ left: centerX(hover), top: yOf(points[hover].value ?? 0) }}>
              <div className="chart-tip-date">{points[hover].date}</div>
              <div className="chart-tip-val">{fmtValue(points[hover])}</div>
              {points[hover].numerator !== undefined && (
                <div className="chart-tip-sub">
                  {points[hover].numerator} / {points[hover].denominator}
                </div>
              )}
            </div>
          )}
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

// Lets the developer point the dashboard at a service key without an env var or rebuild. The active
// key is stored in this browser (localStorage); existing key rows on Projects & keys only hold the
// lookup id and never the raw secret, so a stale/revoked key is replaced by pasting a good one here
// (or generating a fresh one on Projects & keys and clicking "Use this service key for the dashboard").
function ServiceKeyControl(props: { onSaved: () => void }) {
  const [value, setValue] = useState("");
  const hasStored = (() => {
    try {
      return !!localStorage.getItem(SERVICE_KEY_STORAGE);
    } catch {
      return false;
    }
  })();

  function save() {
    const key = value.trim();
    if (!key) return;
    try {
      localStorage.setItem(SERVICE_KEY_STORAGE, key);
    } catch {
      // localStorage can be unavailable in a locked-down browser; fall through and reload anyway.
    }
    setValue("");
    props.onSaved();
  }

  function clear() {
    try {
      localStorage.removeItem(SERVICE_KEY_STORAGE);
    } catch {
      // ignore
    }
    props.onSaved();
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="muted" style={{ marginBottom: 6 }}>
        The dashboard reads the service-gated Insights API. Paste a <b>service</b> key (from
        backend/.seeded-keys.json, or generate one on Projects &amp; keys), or set VITE_SERVICE_KEY.
        {activeServiceKey() ? " A key is currently stored, but it was rejected." : ""}
      </div>
      <div className="keygen">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ls_service_xxxxxxxx.yyyyyyyy"
        />
        <button className="primary" style={{ marginTop: 0 }} onClick={save} disabled={!value.trim()}>
          Save &amp; reload
        </button>
        {hasStored && (
          <button className="ghost" onClick={clear}>
            Clear stored key
          </button>
        )}
      </div>
    </div>
  );
}
