import { useCallback, useEffect, useState } from "react";
import { listActiveSessions, listLogs, updateSession, PortalApiError } from "./api";
import type { AdminSession, JourneyPayload, LogRow } from "./types";

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
        M1 developer testing tool — push a typed Journey state to a live session. Admin token is
        local-demo-only.
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

function UpdateForm(props: { session: AdminSession | null; onApplied: () => void }) {
  const [title, setTitle] = useState("Trip to Rome");
  const [currentStep, setCurrentStep] = useState("Boarding at gate B12");
  const [nextStep, setNextStep] = useState("Flight AZ809");
  const [progress, setProgress] = useState("0.6");
  const [statusText, setStatusText] = useState("Delayed 10 min");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const session = props.session;

  async function submit() {
    if (!session) return;
    setBusy(true);
    setFieldError(null);
    setOkMessage(null);

    const payload: JourneyPayload = {
      type: "journey",
      title,
      currentStep,
      nextStep: nextStep || null,
      statusText: statusText || null,
      progress: progress.trim() === "" ? null : Number(progress),
    };

    try {
      const result = await updateSession(session.sessionId, payload);
      setOkMessage(`Applied version ${result.version}. The device should update within one poll (~8s).`);
      props.onApplied();
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

  if (!session) {
    return (
      <div className="card">
        <h2>Synchronize update</h2>
        <div className="muted">Select a live session on the left to push a new Journey state.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Synchronize update</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        Session <span className="sid">{session.sessionId.slice(0, 8)}…</span> · current v{session.version}
      </div>

      <Field label="Title" value={title} onChange={setTitle} />
      <Field label="Current step" value={currentStep} onChange={setCurrentStep} />
      <Field label="Next step (optional)" value={nextStep} onChange={setNextStep} />
      <Field label="Progress 0–1 (optional; try 1.4 to see a rejection)" value={progress} onChange={setProgress} />
      <Field label="Status text (optional)" value={statusText} onChange={setStatusText} />

      <button className="primary" onClick={submit} disabled={busy}>
        {busy ? "Synchronizing…" : "Synchronize update"}
      </button>

      {fieldError && (
        <div className="error">
          {fieldError.field ? `${fieldError.field}: ` : ""}{fieldError.message}
        </div>
      )}
      {okMessage && <div className="ok">{okMessage}</div>}
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <label>{props.label}</label>
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </>
  );
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
