import { useCallback, useEffect, useState, type ReactNode } from "react";
import { listActiveSessions, listLogs, updateSession, PortalApiError } from "./api";
import type {
  AdminSession,
  CountdownPayload,
  JourneyPayload,
  LogRow,
  ProgressPayload,
  TemplatePayload,
} from "./types";

export function App() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([listActiveSessions(), listLogs()]);
      setSessions(s.sessions);
      setLogs(l.logs);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Load now and poll, so a new activity started on the device appears here.
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
    <div className="app">
      <h1>LiveStage Portal</h1>
      <p className="subtitle">
        Developer testing tool — push a typed state (Journey, Countdown, or Progress) to a live
        session; the form matches the session's template. Admin token is local-demo-only.
      </p>

      {loadError && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="error">Cannot reach the backend ({loadError}). Is it running on the API base URL?</div>
        </div>
      )}

      <div className="cols">
        <div>
          <SessionsPanel
            sessions={sessions}
            selected={selected}
            onSelect={setSelected}
            onRefresh={refresh}
          />
          <div style={{ height: 20 }} />
          <LogsPanel logs={logs} />
        </div>

        <UpdateForm
          session={sessions.find((s) => s.sessionId === selected) ?? null}
          onApplied={refresh}
        />
      </div>
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

// The form is typed to the selected session's template (build spec §8.3 / design §09): the right
// fields render for journey | countdown | progress, and the same PATCH /v1/admin/activities path is
// used. Switching session resets the form via a `key` on the session id.
function UpdateForm(props: { session: AdminSession | null; onApplied: () => void }) {
  const session = props.session;
  if (!session) {
    return (
      <div className="card">
        <h2>Synchronize update</h2>
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
      <h2>Synchronize update</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        Session <span className="sid">{props.session.sessionId.slice(0, 8)}…</span> · {props.session.type} · current
        v{props.session.version}
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
    };
    submit(payload);
  }

  return (
    <FormShell session={props.session} busy={busy} fieldError={fieldError} okMessage={okMessage} onSubmit={onSubmit}>
      <TextField label="Title" value={title} onChange={setTitle} />
      <TextField label="Current step" value={currentStep} onChange={setCurrentStep} />
      <TextField label="Next step (optional)" value={nextStep} onChange={setNextStep} />
      <TextField label="Progress 0–1 (optional; try 1.4 to see a rejection)" value={progress} onChange={setProgress} />
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
      progress: Number(progress),
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

function LogsPanel(props: { logs: LogRow[] }) {
  return (
    <div className="card">
      <h2>Logs</h2>
      {props.logs.length === 0 && <div className="muted">No logs yet.</div>}
      {props.logs.slice(0, 15).map((l) => (
        <div key={l.id} className={`logline${l.kind === "reject" ? " reject" : ""}`}>
          {l.kind}/{l.status}{l.detail ? ` — ${l.detail}` : ""}
        </div>
      ))}
    </div>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}
