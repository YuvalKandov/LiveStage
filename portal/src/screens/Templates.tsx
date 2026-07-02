import { useCallback, useEffect, useState } from "react";
import { createTemplate, listProjects, listTemplates, updateTemplate, PortalApiError } from "../api";
import { Plus } from "lucide-react";
import { ACCENT_STYLES, ICON_ALLOWLIST, type AccentStyle, type Project, type TemplateConfig, type TemplateLabels, type TemplateType } from "../types";
import { Preview, type PreviewDraft } from "../preview/Preview";
import { PageHeader } from "../components/PageHeader";
import { CopyButton } from "../components/CopyButton";

// Templates list + typed config editor (build spec §10, design §09). Authoring goes through the
// admin plane; the server validates the icon against the allowlist, the accent against the palette,
// the type, and the lengths. zeroStateLabel is entered as a label field (countdown only) and the
// server stores it internally, folding it back into labels.zeroStateLabel on read. The four-surface
// preview is added in the next checkpoint; the iOS simulator stays the authoritative renderer.

const ACCENT_HEX: Record<AccentStyle, string> = {
  blue: "#0a84ff",
  orange: "#ff9f0a",
  green: "#30d158",
  indigo: "#5e5ce6",
  teal: "#64d2ff",
};

export function Templates() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateConfig[]>([]);
  const [editing, setEditing] = useState<TemplateConfig | "new" | null>(null);
  const [previewDraft, setPreviewDraft] = useState<PreviewDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shown at the list level: the editor unmounts on save, so a message inside it would never be seen.
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then(({ projects }) => {
        setProjects(projects);
        setProjectId((cur) => cur ?? projects[0]?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const loadTemplates = useCallback(async () => {
    if (!projectId) return;
    try {
      const { templates } = await listTemplates(projectId);
      setTemplates(templates);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    setEditing(null);
    loadTemplates();
  }, [loadTemplates]);

  return (
    <div>
      <PageHeader
        title="Templates"
        subtitle="Author branding, labels, deep-link base, and stale window. Edits affect new activities only."
        actions={
          <button
            className="ghost"
            onClick={() => {
              setSavedMessage(null);
              setEditing("new");
            }}
          >
            <Plus size={13} aria-hidden /> New template
          </button>
        }
      />
      {error && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="error">{error}</div>
        </div>
      )}
      {savedMessage && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="ok">{savedMessage}</div>
        </div>
      )}
      <div className="cols">
        <div className="card">
          <label>Project</label>
          <select className="metric-select" style={{ width: "100%", margin: 0 }} value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div style={{ height: 12 }} />
          {templates.length === 0 && <div className="muted">No templates in this project yet.</div>}
          {templates.map((t) => (
            <button
              key={t.id}
              className={`session${editing !== "new" && editing?.id === t.id ? " selected" : ""}`}
              onClick={() => {
                setSavedMessage(null);
                setEditing(t);
              }}
            >
              <div className="row">
                <span><span className="tic" style={{ background: ACCENT_HEX[t.accent] }} />{t.displayName}</span>
                <span className="sid">{t.templateId}</span>
              </div>
              <div className="muted">{t.type} · {t.icon} · stale {t.staleAfterSeconds}s</div>
            </button>
          ))}
        </div>

        {editing && projectId ? (
          <TemplateEditor
            key={editing === "new" ? "new" : editing.id}
            projectId={projectId}
            template={editing === "new" ? null : editing}
            onDraft={setPreviewDraft}
            onSaved={(message) => {
              setSavedMessage(message);
              loadTemplates();
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="card">
            <h2>Editor</h2>
            <div className="muted">Select a template to edit, or create a new one.</div>
          </div>
        )}
      </div>

      {editing && previewDraft && (
        <div className="card" style={{ marginTop: 20 }}>
          <Preview draft={previewDraft} />
        </div>
      )}
    </div>
  );
}

function TemplateEditor(props: {
  projectId: string;
  template: TemplateConfig | null;
  onDraft: (draft: PreviewDraft) => void;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const t = props.template;
  const isNew = t === null;
  const [templateId, setTemplateId] = useState(t?.templateId ?? "");
  const [type, setType] = useState<TemplateType>(t?.type ?? "journey");
  const [displayName, setDisplayName] = useState(t?.displayName ?? "");
  const [icon, setIcon] = useState(t?.icon ?? ICON_ALLOWLIST[0]);
  const [accent, setAccent] = useState<AccentStyle>(t?.accent ?? "blue");
  const [deepLinkBase, setDeepLinkBase] = useState(t?.deepLinkBase ?? "triptogether://");
  const [labels, setLabels] = useState<TemplateLabels>(t?.labels ?? {});
  const [staleAfterSeconds, setStaleAfterSeconds] = useState(String(t?.staleAfterSeconds ?? 900));
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);

  function setLabel(key: keyof TemplateLabels, value: string) {
    setLabels((cur) => ({ ...cur, [key]: value }));
  }

  // Feed the live draft up so the four-surface preview reflects edits as they happen.
  const { onDraft } = props;
  useEffect(() => {
    onDraft({ type, icon, accent, labels });
  }, [onDraft, type, icon, accent, labels]);

  async function save() {
    setFieldError(null);
    // Number("abc") is NaN, which JSON-serializes to null and the backend would silently fall back
    // to its default instead of erroring. Reject it here with a clear message instead.
    const stale = Number(staleAfterSeconds);
    if (staleAfterSeconds.trim() === "" || !Number.isInteger(stale) || stale <= 0) {
      setFieldError({
        field: "staleAfterSeconds",
        message: `Stale after must be a positive whole number of seconds (got "${staleAfterSeconds}").`,
      });
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      type,
      displayName,
      icon,
      accent,
      deepLinkBase,
      labels,
      staleAfterSeconds: stale,
    };
    try {
      if (isNew) {
        await createTemplate({ ...body, projectId: props.projectId, templateId });
      } else {
        await updateTemplate(t.id, body);
      }
      props.onSaved(
        isNew
          ? "Template created. It is available to new activities immediately."
          : "Saved. Template edits affect new activities only; running activities keep their frozen config.",
      );
    } catch (e) {
      if (e instanceof PortalApiError && (e.status === 400 || e.status === 409)) {
        setFieldError({ field: e.body.field, message: e.body.message });
      } else {
        setFieldError({ message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>{isNew ? "New template" : `Edit ${t.displayName}`}</h2>

      <div className="label-row">
        <label>Template id {isNew ? "(unique per project)" : "(fixed)"}</label>
        {!isNew && <CopyButton text={templateId} label="" title="Copy template id" />}
      </div>
      <input value={templateId} disabled={!isNew} onChange={(e) => setTemplateId(e.target.value)} placeholder="e.g. ride-status" />

      <label>Template type</label>
      <select className="metric-select" style={{ width: "100%", margin: 0 }} value={type} onChange={(e) => setType(e.target.value as TemplateType)}>
        <option value="journey">journey</option>
        <option value="countdown">countdown</option>
        <option value="progress">progress</option>
      </select>

      <label>Display name</label>
      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Ride status" />

      <label>Icon (from allowlist)</label>
      <select className="metric-select" style={{ width: "100%", margin: 0 }} value={icon} onChange={(e) => setIcon(e.target.value)}>
        {ICON_ALLOWLIST.map((i) => (
          <option key={i} value={i}>{i}</option>
        ))}
      </select>

      <label>Accent</label>
      <div className="swatches">
        {ACCENT_STYLES.map((a) => (
          <button
            key={a}
            type="button"
            className={`swatch${accent === a ? " on" : ""}`}
            style={{ background: ACCENT_HEX[a] }}
            title={a}
            onClick={() => setAccent(a)}
          />
        ))}
      </div>

      <label>Deep link base</label>
      <input value={deepLinkBase} onChange={(e) => setDeepLinkBase(e.target.value)} placeholder="triptogether://trip" />

      <label>Labels</label>
      <LabelField label="Next step label" value={labels.nextStepLabel ?? ""} onChange={(v) => setLabel("nextStepLabel", v)} />
      <LabelField label="Target label" value={labels.targetLabel ?? ""} onChange={(v) => setLabel("targetLabel", v)} />
      <LabelField label="Countdown label" value={labels.countdownLabel ?? ""} onChange={(v) => setLabel("countdownLabel", v)} />
      <LabelField label="Completion label" value={labels.completionLabel ?? ""} onChange={(v) => setLabel("completionLabel", v)} />
      {type === "countdown" && (
        <LabelField label="Zero-state label (countdown)" value={labels.zeroStateLabel ?? ""} onChange={(v) => setLabel("zeroStateLabel", v)} />
      )}

      <label>Stale after (seconds)</label>
      <input value={staleAfterSeconds} onChange={(e) => setStaleAfterSeconds(e.target.value)} />

      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" style={{ marginTop: 0 }} onClick={save} disabled={busy}>
          {busy ? "Saving…" : isNew ? "Create template" : "Save changes"}
        </button>
        <button className="ghost" onClick={props.onCancel}>Cancel</button>
      </div>

      {fieldError && (
        <div className="error">
          {fieldError.field ? `${fieldError.field}: ` : ""}
          {fieldError.message}
        </div>
      )}
    </div>
  );
}

function LabelField(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="label-field">
      <span className="muted">{props.label}</span>
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </div>
  );
}
