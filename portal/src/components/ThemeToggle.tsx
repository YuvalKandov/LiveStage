import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { getThemeMode, resolveTheme, setThemeMode } from "../theme";

// A small icon button in the top bar that flips the console between light and dark. It shows the
// moon in light mode (click to go dark) and the sun in dark mode (click to go light). First load
// follows the OS setting (theme.ts "system" default); clicking sets an explicit preference.
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() => resolveTheme(getThemeMode()));

  // Keep the icon in sync if the OS theme changes while we are still on the system default.
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setTheme(resolveTheme(getThemeMode()));
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  function flip() {
    const next = theme === "dark" ? "light" : "dark";
    setThemeMode(next);
    setTheme(next);
  }

  const isDark = theme === "dark";
  return (
    <button
      className="theme-toggle"
      onClick={flip}
      title={isDark ? "Switch to light" : "Switch to dark"}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
    </button>
  );
}
