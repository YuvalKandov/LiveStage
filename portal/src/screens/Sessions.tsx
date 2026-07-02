import { useCallback, useEffect, useState, type ReactNode } from "react";
import { listActiveSessions, updateSession, PortalApiError } from "../api";
import { PageHeader } from "../components/PageHeader";
import {
  getSessionTimeline,
  InsightsApiError,
  NoServiceKeyError,
  type SessionTimeline,
  type TimelineEvent,
} from "../insights";
import type {
  AdminSession,
  CountdownPayload,
  JourneyPayload,
  ProgressPayload,
  TemplatePayload,
} from "../types";

// Sessions screen: the live-sessions list, the per-session event-timeline explorer, and the typed
// developer testing tool (build spec §10, design §09). The explorer reads the service-gated Insights
// API; the list and testing tool use the admin plane. The testing tool is for exercising the full
// flow without changing the demo app's business logic - it is not a core operating surface, and it
// synchronizes a state the SDK applies (it does not push to a suspended app in V1).

export function Sessions() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await listActiveSessions();
      setSessions(s.sessions);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Poll so a new activity started on the device/simulator appears here.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Keep the selection valid as the list changes.
  useEffect(() => {
    if (selected && !sessions.some((s) => s.sessionId === selected)) setSelected(null);
  }, [sessions, selected]);

  return (
    <div>
      <PageHeader
        title="Sessions"
        subtitle="Watch live sessions and drive their state by hand to test the full loop from the browser."
      />
      {loadError && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="error">Cannot reach the backend ({loadError}). Is it running on the API base URL?</div>
        </div>
      )}
      <div className="cols">
        <SessionsPanel sessions={sessions} selected={selected} onSelect={setSelected} onRefresh={refresh} />
        <div>
          {selected && <SessionExplorer sessionId={selected} />}
          <UpdateForm session={sessions.find((s) => s.sessionId === selected) ?? null} onApplied={refresh} />
        </div>
      </div>
    </div>
  );
}

// The session explorer (design §09): one session's content-free event timeline from the Insights API
// (GET /v1/insights/sessions/:id). Ordered by occurredAt (device time, for display only); state_applied
// shows the applied version and its server-clock acknowledged latency; opens and expanded-action taps
// are highlighted. No Live Activity state is shown - the endpoint carries none.
function SessionExplorer(props: { sessionId: string }) {
  const [timeline, setTimeline] = useState<SessionTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsKey(false);
    try {
      setTimeline(await getSessionTimeline(props.sessionId));
    } catch (e) {
      setTimeline(null);
      if (e instanceof NoServiceKeyError) {
        setNeedsKey(true);
        setError(e.message);
      } else if (e instanceof InsightsApiError && e.status === 404) {
        setError("No timeline for this session (it may belong to a different project than the service key).");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [props.sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="row">
        <h2>Session timeline</h2>
        <button className="ghost" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <>
          <div className="error">{error}</div>
          {needsKey && (
            <div className="muted" style={{ marginTop: 8 }}>
              The timeline reads the service-gated Insights API. Set VITE_SERVICE_KEY or generate a
              service key on the Projects &amp; keys screen.
            </div>
          )}
        </>
      )}

      {timeline && (
        <>
          <div className="muted" style={{ marginBottom: 10 }}>
            {timeline.templateId} · {timeline.type} · {timeline.status}
            {timeline.endedAt ? ` · ended ${fmt(timeline.endedAt)}` : ""}
          </div>
          {timeline.events.length === 0 && <div className="muted">No events recorded for this session yet.</div>}
          {timeline.events.map((e) => (
            <TimelineRow key={e.eventId} event={e} />
          ))}
          {timeline.events.length > 0 && (
            <div className="muted" style={{ marginTop: 10 }}>
              Times shown are device occurredAt (timeline display only); latency is server-clock
              (acknowledged, includes upload delay). Events carry identifiers and event types only, no
              activity content.
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Whether an event is an intentional user interaction (highlighted in the timeline). */
function isInteraction(eventType: string): boolean {
  return eventType === "activity_opened" || eventType === "expanded_action_tapped";
}

function latencyText(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function TimelineRow(props: { event: TimelineEvent }) {
  const e = props.event;
  const extras: string[] = [];
  if (e.eventType === "state_applied" && e.version !== undefined) {
    extras.push(`v${e.version}`);
    if (e.latencyMs !== undefined) extras.push(`latency ${latencyText(e.latencyMs)}`);
  }
  if (e.metadata?.source) extras.push(`source=${e.metadata.source}`);
  if (e.metadata?.reason) extras.push(`reason=${e.metadata.reason}`);

  const cls = isInteraction(e.eventType) ? " interaction" : e.eventType === "sync_failed" ? " reject" : "";
  return (
    <div className={`logline${cls}`}>
      <span className="muted">{fmt(e.occurredAt)}</span> {e.eventType}
      {extras.length > 0 ? ` ${extras.join(" · ")}` : ""}
    </div>
  );
}

function SessionsPanel(props: {
  sessions: AdminSession[];
  selected: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="card">
      <div className="row">
        <h2>Live sessions ({props.sessions.length})</h2>
        <button className="ghost" onClick={props.onRefresh}>Refresh</button>
      </div>
      {props.sessions.length === 0 && <div className="muted">No active sessions. Start one from the demo app.</div>}
      {props.sessions.map((s) => (
        <button
          key={s.sessionId}
          className={`session${props.selected === s.sessionId ? " selected" : ""}`}
          onClick={() => props.onSelect(s.sessionId)}
        >
          <div className="row">
            <span className="sid">{s.sessionId.slice(0, 8)}…</span>
            <span className="badge">v{s.version}</span>
          </div>
          <div className="muted">{s.templateId} · {s.type} · updated {fmt(s.lastUpdatedAt)}</div>
        </button>
      ))}
    </div>
  );
}

// The form is typed to the selected session's template: the right fields render for
// journey | countdown | progress, all using the same PATCH /v1/admin/activities path. Switching
// session resets the form via a `key` on the session id.
function UpdateForm(props: { session: AdminSession | null; onApplied: () => void }) {
  const session = props.session;
  if (!session) {
    return (
      <div className="card">
        <h2>Developer testing tool</h2>
        <div className="muted">Select a live session on the left to push a new typed state.</div>
      </div>
    );
  }
  switch (session.type) {
    case "countdown":
      return <CountdownForm key={session.sessionId} session={session} onApplied={props.onApplied} />;
    case "progress":
      return <ProgressForm key={session.sessionId} session={session} onApplied={props.onApplied} />;
    default:
      return <JourneyForm key={session.sessionId} session={session} onApplied={props.onApplied} />;
  }
}

/** Shared submit + busy/error/ok state for all three typed forms (one PATCH path, one error model). */
function useUpdateSubmit(session: AdminSession, onApplied: () => void) {
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  async function submit(payload: TemplatePayload) {
    setBusy(true);
    setFieldError(null);
    setOkMessage(null);
    try {
      const result = await updateSession(session.sessionId, payload);
      setOkMessage(`Applied version ${result.version}. The device should update within one poll (~8s).`);
      onApplied();
    } catch (e) {
      if (e instanceof PortalApiError && e.status === 400) {
        setFieldError({ field: e.body.field, message: e.body.message });
      } else {
        setFieldError({ message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setBusy(false);
    }
  }
  return { busy, fieldError, okMessage, submit };
}

/** The card chrome shared by every typed form: header, submit button, inline error/ok. */
function FormShell(props: {
  session: AdminSession;
  busy: boolean;
  fieldError: { field?: string; message: string } | null;
  okMessage: string | null;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <h2>Developer testing tool</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        Synchronize a typed state to session <span className="sid">{props.session.sessionId.slice(0, 8)}…</span> ·{" "}
        {props.session.type} · current v{props.session.version}. For testing the full flow, not a core
        operating surface.
      </div>

      {props.children}

      <button className="primary" onClick={props.onSubmit} disabled={props.busy}>
        {props.busy ? "Synchronizing…" : "Synchronize update"}
      </button>

      {props.fieldError && (
        <div className="error">
          {props.fieldError.field ? `${props.fieldError.field}: ` : ""}
          {props.fieldError.message}
        </div>
      )}
      {props.okMessage && <div className="ok">{props.okMessage}</div>}
    </div>
  );
}

function JourneyForm(props: { session: AdminSession; onApplied: () => void }) {
  const [title, setTitle] = useState("Trip to Rome");
  const [currentStep, setCurrentStep] = useState("Boarding at gate B12");
  const [nextStep, setNextStep] = useState("Flight AZ809");
  const [progress, setProgress] = useState("0.6");
  const [targetLocal, setTargetLocal] = useState(defaultLocalDateTime(90));
  const [statusText, setStatusText] = useState("Delayed 10 min");
  const { busy, fieldError, okMessage, submit } = useUpdateSubmit(props.session, props.onApplied);

  function onSubmit() {
    const payload: JourneyPayload = {
      type: "journey",
      title,
      currentStep,
      nextStep: nextStep || null,
      statusText: statusText || null,
      progress: progress.trim() === "" ? null : Number(progress),
      // An update replaces the whole payload, so leaving this empty removes the target line from the
      // activity. Defaulted to a future time so an update doesn't silently strip "Arrives at ...".
      targetDate: targetLocal ? new Date(targetLocal).toISOString() : null,
    };
    submit(payload);
  }

  return (
    <FormShell session={props.session} busy={busy} fieldError={fieldError} okMessage={okMessage} onSubmit={onSubmit}>
      <TextField label="Title" value={title} onChange={setTitle} />
      <TextField label="Current step" value={currentStep} onChange={setCurrentStep} />
      <TextField label="Next step (optional)" value={nextStep} onChange={setNextStep} />
      <TextField label="Progress 0–1 (optional; try 1.4 to see a rejection)" value={progress} onChange={setProgress} />
      <label>Target / arrival time (optional; empty removes it from the activity)</label>
      <input type="datetime-local" value={targetLocal} onChange={(e) => setTargetLocal(e.target.value)} />
      <TextField label="Status text (optional)" value={statusText} onChange={setStatusText} />
    </FormShell>
  );
}

function CountdownForm(props: { session: AdminSession; onApplied: () => void }) {
  const [title, setTitle] = useState("Flight to Rome");
  const [subtitle, setSubtitle] = useState("Gate B12");
  const [targetLocal, setTargetLocal] = useState(defaultLocalDateTime(30));
  const [statusText, setStatusText] = useState("On time");
  const [location, setLocation] = useState("Terminal 3");
  const { busy, fieldError, okMessage, submit } = useUpdateSubmit(props.session, props.onApplied);

  function onSubmit() {
    const payload: CountdownPayload = {
      type: "countdown",
      title,
      subtitle: subtitle || null,
      // datetime-local is a local wall-clock value; convert to a tz-aware UTC instant for the backend.
      targetDate: targetLocal ? new Date(targetLocal).toISOString() : "",
      statusText: statusText || null,
      location: location || null,
    };
    submit(payload);
  }

  return (
    <FormShell session={props.session} busy={busy} fieldError={fieldError} okMessage={okMessage} onSubmit={onSubmit}>
      <TextField label="Title" value={title} onChange={setTitle} />
      <TextField label="Subtitle (optional)" value={subtitle} onChange={setSubtitle} />
      <label>Target date/time (required)</label>
      <input type="datetime-local" value={targetLocal} onChange={(e) => setTargetLocal(e.target.value)} />
      <TextField label="Status text (optional)" value={statusText} onChange={setStatusText} />
      <TextField label="Location (optional)" value={location} onChange={setLocation} />
    </FormShell>
  );
}

function ProgressForm(props: { session: AdminSession; onApplied: () => void }) {
  const [title, setTitle] = useState("Preparing your order");
  const [currentStage, setCurrentStage] = useState("Packing");
  const [progress, setProgress] = useState("0.8");
  const [etaLocal, setEtaLocal] = useState("");
  const [detailText, setDetailText] = useState("2 items left");
  const { busy, fieldError, okMessage, submit } = useUpdateSubmit(props.session, props.onApplied);

  function onSubmit() {
    const payload: ProgressPayload = {
      type: "progress",
      title,
      currentStage: currentStage || null,
      // Number("") is 0, which would silently submit a valid 0% update. NaN serializes to null, so
      // an empty field surfaces the server's "progress is required" error instead.
      progress: Number(progress.trim() === "" ? NaN : progress),
      estimatedCompletionDate: etaLocal ? new Date(etaLocal).toISOString() : null,
      detailText: detailText || null,
    };
    submit(payload);
  }

  return (
    <FormShell session={props.session} busy={busy} fieldError={fieldError} okMessage={okMessage} onSubmit={onSubmit}>
      <TextField label="Title" value={title} onChange={setTitle} />
      <TextField label="Current stage (optional)" value={currentStage} onChange={setCurrentStage} />
      <TextField label="Progress 0–1 (required; try 1.4 to see a rejection)" value={progress} onChange={setProgress} />
      <label>Estimated completion (optional)</label>
      <input type="datetime-local" value={etaLocal} onChange={(e) => setEtaLocal(e.target.value)} />
      <TextField label="Detail text (optional)" value={detailText} onChange={setDetailText} />
    </FormShell>
  );
}

function TextField(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <label>{props.label}</label>
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </>
  );
}

/** A `datetime-local` default `minutesAhead` from now, formatted as the input expects (local time). */
function defaultLocalDateTime(minutesAhead: number): string {
  const d = new Date(Date.now() + minutesAhead * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}
