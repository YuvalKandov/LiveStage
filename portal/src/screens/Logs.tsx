import { useCallback, useEffect, useState } from "react";
import { listLogs } from "../api";
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
    <div className="card">
      <div className="row">
        <h2>Logs</h2>
        <button className="ghost" onClick={refresh}>Refresh</button>
      </div>
      {loadError && <div className="error">Cannot reach the backend ({loadError}).</div>}
      {logs.length === 0 && !loadError && <div className="muted">No logs yet.</div>}
      {logs.slice(0, 50).map((l) => (
        <div key={l.id} className={`logline${l.kind === "reject" ? " reject" : ""}`}>
          {l.kind}/{l.status}
          {l.session_id ? ` · ${l.session_id.slice(0, 8)}…` : ""}
          {l.detail ? ` - ${l.detail}` : ""}
        </div>
      ))}
    </div>
  );
}
