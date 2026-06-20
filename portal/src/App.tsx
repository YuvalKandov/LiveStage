import { useState } from "react";
import { Analytics } from "./screens/Analytics";
import { Sessions } from "./screens/Sessions";
import { Logs } from "./screens/Logs";
import { ProjectsKeys } from "./screens/ProjectsKeys";
import { Templates } from "./screens/Templates";

// The developer console shell (build spec §10, design §09). A lightweight in-state tab switcher (no
// router dependency) hosts the screens. The analytics dashboard + session explorer are the
// centerpiece; the typed update form is a developer testing tool, not a core operating surface.
// Projects & keys (CP4) and the template editor (CP5) land in later checkpoints.

type Tab = "analytics" | "sessions" | "templates" | "logs" | "projects";

const TABS: { id: Tab; label: string }[] = [
  { id: "analytics", label: "Analytics" },
  { id: "sessions", label: "Sessions" },
  { id: "templates", label: "Templates" },
  { id: "logs", label: "Logs" },
  { id: "projects", label: "Projects & keys" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("analytics");

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand-dot" aria-hidden />
        <b className="brand">LiveStage</b>
        <span className="chip">Demo Project</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab${tab === t.id ? " on" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "analytics" && <Analytics />}
      {tab === "sessions" && <Sessions />}
      {tab === "logs" && <Logs />}
      {tab === "templates" && <Templates />}
      {tab === "projects" && <ProjectsKeys />}
    </div>
  );
}
