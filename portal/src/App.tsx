import { useState } from "react";
import { BarChart3, Radio, LayoutTemplate, ScrollText, KeyRound, type LucideIcon } from "lucide-react";
import { Analytics } from "./screens/Analytics";
import { Sessions } from "./screens/Sessions";
import { Logs } from "./screens/Logs";
import { ProjectsKeys } from "./screens/ProjectsKeys";
import { Templates } from "./screens/Templates";
import { ThemeToggle } from "./components/ThemeToggle";

// The developer console shell (build spec §10, design §09). A lightweight in-state tab switcher (no
// router dependency) hosts the screens. The analytics dashboard + session explorer are the
// centerpiece; the typed update form is a developer testing tool, not a core operating surface.
// Projects & keys (CP4) and the template editor (CP5) land in later checkpoints.

type Tab = "analytics" | "sessions" | "templates" | "logs" | "projects";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "sessions", label: "Sessions", icon: Radio },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "projects", label: "Projects & keys", icon: KeyRound },
];

export function App() {
  const [tab, setTab] = useState<Tab>("analytics");

  return (
    <div className="app">
      <div className="topbar">
        <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden />
        <b className="brand">LiveStage</b>
        <span className="chip">Demo Project</span>
        <nav className="tabs">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                className={`tab${tab === t.id ? " on" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <Icon size={15} strokeWidth={2} aria-hidden />
                {t.label}
              </button>
            );
          })}
        </nav>
        <ThemeToggle />
      </div>

      {tab === "analytics" && <Analytics />}
      {tab === "sessions" && <Sessions />}
      {tab === "logs" && <Logs />}
      {tab === "templates" && <Templates />}
      {tab === "projects" && <ProjectsKeys />}
    </div>
  );
}
