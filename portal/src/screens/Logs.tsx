import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { listLogs } from "../api";
import { PageHeader } from "../components/PageHeader";
import type { LogRow } from "../types";

// Lifecycle + rejection logs (build spec §10, design §09): start/update/end and server-rejected
// updates with the actionable reason.
export function Logs() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const l = await listLogs();
      setLogs(l.logs);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div>
      <PageHeader
        title="Logs"
        subtitle="Lifecycle and server-rejected updates, with the actionable reason."
        actions={
          <button className="ghost" onClick={refresh}>
            <RefreshCw size={13} aria-hidden /> Refresh
          </button>
        }
      />
      <div className="card">
        {loadError && <div className="error">Cannot reach the backend ({loadError}).</div>}
        {logs.length === 0 && !loadError && <div className="muted">No logs yet.</div>}
        {logs.slice(0, 50).map((l) => (
          <LogLine key={l.id} log={l} />
        ))}
      </div>
    </div>
  );
}

// A scannable log row: timestamp, a kind chip (colored by lifecycle/rejection), a status chip, the
// session token, and the actionable reason (emphasized for rejections).
function LogLine(props: { log: LogRow }) {
  const l = props.log;
  const reject = l.kind === "reject";
  // An `end` carrying a failure reason is the SDK's orphan-cleanup path (build spec §5.1): the end
  // call itself succeeded (status ok), but it means an activity failed to start on the device. Flag
  // it as a warning so it doesn't read as a clean success.
  const cleanup = l.kind === "end" && !!l.detail && /fail|error/i.test(l.detail);
  const rowCls = reject ? " reject" : cleanup ? " warn" : "";
  return (
    <div className={`log-row${rowCls}`}>
      <span className="log-time">{fmtTime(l.created_at)}</span>
      <span className={`log-chip kind-${reject ? "reject" : "lifecycle"}`}>{l.kind}</span>
      <span className={`log-chip status-${l.status}`}>{l.status}</span>
      <span className="log-sid" title={l.session_id ?? undefined}>
        {l.template_id ?? l.type ?? ""}
        {(l.template_id ?? l.type) && l.session_id ? " · " : ""}
        {l.session_id ? l.session_id.slice(0, 8) : ""}
      </span>
      {l.detail && <span className={`log-detail${reject ? " strong" : cleanup ? " warn" : ""}`}>{l.detail}</span>}
    </div>
  );
}

/** created_at -> local time of day; falls back to the raw value if it isn't a parseable instant. */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}
