import { useCallback, useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { createApiKey, createProject, listApiKeys, listProjects, revokeApiKey, PortalApiError } from "../api";
import { API_BASE, SERVICE_KEY_STORAGE } from "../config";
import { PageHeader } from "../components/PageHeader";
import { CopyButton } from "../components/CopyButton";
import type { ApiKeyMeta, CreatedApiKey, KeyType, Project } from "../types";

// Projects & API keys (build spec §10, §12). The admin plane (admin token) manages projects and
// keys. Two key types are generated here with a clear distinction: a `mobile` key ships in the app
// (SDK writes/events, rejected by Insights) and a `service` key reads the Insights API (never shipped,
// rejected by mutation routes). A key is shown exactly once; only the secret hash is stored. The
// dashboard can be pointed at a generated service key, stored locally for this browser.

export function ProjectsKeys() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The raw mobile key most recently generated for the selected project, folded into the snippet.
  const [mobileKey, setMobileKey] = useState<string | null>(null);

  useEffect(() => {
    setMobileKey(null); // a key belongs to its project; never show it under another one
  }, [selected]);

  const loadProjects = useCallback(async () => {
    try {
      const { projects } = await listProjects();
      setProjects(projects);
      setError(null);
      setSelected((cur) => cur ?? projects[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div>
      <PageHeader
        title="Projects & keys"
        subtitle="Manage projects and the mobile and service keys the SDK and Insights API authenticate with."
      />
      {error && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="error">Cannot reach the admin API ({error}).</div>
        </div>
      )}
      <div className="cols">
        <ProjectsPanel projects={projects} selected={selected} onSelect={setSelected} onCreated={loadProjects} />
        {selected ? (
          <KeysPanel projectId={selected} onMobileKey={setMobileKey} />
        ) : (
          <div className="card">
            <h2>API keys</h2>
            <div className="muted">Create or select a project to manage its keys.</div>
          </div>
        )}
      </div>

      {selected && <IntegrationSnippet mobileKey={mobileKey} />}
    </div>
  );
}

/** Copy-paste Swift integration for the selected project: configure once at launch, then start with
 *  typed state. A freshly generated mobile key is filled in (it is shown raw exactly once). */
function IntegrationSnippet(props: { mobileKey: string | null }) {
  const key = props.mobileKey ?? "ls_mobile_<id>.<secret>";
  const code = `import LiveStage
import LiveStageModels

// Once at launch:
LiveStage.configure(
    apiKey: "${key}",
    baseURL: URL(string: "${API_BASE}")!
)

// Start a Live Activity from typed state:
let session = try await LiveStage.start(
    templateId: "trip-status",
    deepLinkParameters: ["tripId": "123"],
    state: .journey(JourneyState(
        title: "Trip to Rome",
        currentStep: "Boarding at gate B12",
        progress: 0.6
    ))
)`;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row">
        <h2>Integration snippet</h2>
        <CopyButton text={code} label="Copy" />
      </div>
      <div className="muted" style={{ marginBottom: 10 }}>
        {props.mobileKey
          ? "Filled in with the mobile key you just generated (copy it now - it is shown only once)."
          : "Generate a mobile key above and it is filled in here automatically."}{" "}
        The full walkthrough (Widget Extension, deep links) is in the docs.
      </div>
      <pre className="snippet">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ProjectsPanel(props: {
  projects: Project[];
  selected: string | null;
  onSelect: (id: string) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createProject(name.trim());
      setName("");
      props.onCreated();
    } catch (e) {
      setError(e instanceof PortalApiError ? e.body.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Projects</h2>
      {props.projects.length === 0 && <div className="muted">No projects yet.</div>}
      {props.projects.map((p) => (
        <button
          key={p.id}
          className={`session${props.selected === p.id ? " selected" : ""}`}
          onClick={() => props.onSelect(p.id)}
        >
          <div className="row">
            <span>{p.name}</span>
            <span className="sid">{p.id.slice(0, 8)}…</span>
          </div>
        </button>
      ))}

      <label>New project name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. TripTogether" />
      <button className="primary" onClick={create} disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Create project"}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function KeysPanel(props: { projectId: string; onMobileKey: (raw: string) => void }) {
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [keyType, setKeyType] = useState<KeyType>("service");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [activeServiceId, setActiveServiceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { keys } = await listApiKeys(props.projectId);
      setKeys(keys);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.projectId]);

  // The just-created key is project-scoped; clear it when the project changes.
  useEffect(() => {
    setCreated(null);
    load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const key = await createApiKey(props.projectId, keyType, label.trim());
      setCreated(key);
      if (key.keyType === "mobile") props.onMobileKey(key.key);
      setLabel("");
      load();
    } catch (e) {
      setError(e instanceof PortalApiError ? e.body.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await revokeApiKey(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function useForDashboard(rawKey: string, id: string) {
    localStorage.setItem(SERVICE_KEY_STORAGE, rawKey);
    setActiveServiceId(id);
  }

  return (
    <div className="card">
      <h2>API keys</h2>
      <div className="muted" style={{ marginBottom: 10 }}>
        <b>mobile</b> keys ship in the app (SDK writes and events; rejected by the Insights API).{" "}
        <b>service</b> keys read the Insights API only (never shipped; rejected by mutation routes).
      </div>

      {created && (
        <div className="reveal">
          <div className="reveal-title">
            New {created.keyType} key - copy it now, it is shown only once
          </div>
          <code className="reveal-key">{created.key}</code>
          <div style={{ marginTop: 8 }}>
            <CopyButton text={created.key} label="Copy key" />
          </div>
          {created.keyType === "service" && (
            <button className="ghost" style={{ marginTop: 8 }} onClick={() => useForDashboard(created.key, created.id)}>
              Use this service key for the dashboard
            </button>
          )}
          {activeServiceId === created.id && (
            <div className="ok" style={{ marginTop: 6 }}>
              Stored in this browser. The Analytics dashboard now reads with this service key.
            </div>
          )}
        </div>
      )}

      {keys.length === 0 && <div className="muted">No keys for this project yet.</div>}
      {keys.map((k) => (
        <div key={k.id} className="keyrow">
          <span className={`pill ${k.keyType}`}>{k.keyType}</span>
          <span className="sid">{k.id}</span>
          <CopyButton text={k.id} label="" title="Copy key id" />
          <span className="muted">{k.label || "(no label)"}</span>
          {k.revoked ? (
            <span className="muted revoked">revoked</span>
          ) : (
            <button className="ghost" onClick={() => revoke(k.id)}>
              <Ban size={13} aria-hidden /> Revoke
            </button>
          )}
        </div>
      ))}

      <label>Generate a key</label>
      <div className="keygen">
        <select className="metric-select" value={keyType} onChange={(e) => setKeyType(e.target.value as KeyType)}>
          <option value="service">service (Insights reads)</option>
          <option value="mobile">mobile (SDK, shippable)</option>
        </select>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" />
        <button className="primary" style={{ marginTop: 0 }} onClick={generate} disabled={busy}>
          {busy ? "Generating…" : "Generate"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
