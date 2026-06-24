// Theme state for the console: light / dark / system. The chosen mode is stored in this browser
// (localStorage, mirroring the service-key pattern in config.ts) and applied by setting
// `data-theme` on <html>. In "system" mode we follow the OS `prefers-color-scheme` and react live
// when the user flips their system setting. Apply early (before first paint) to avoid a flash.

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "livestage.theme";
const mql = () => window.matchMedia("(prefers-color-scheme: dark)");

/** The saved mode, defaulting to "system" when nothing is stored or storage is unavailable. */
export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // localStorage can throw in a locked-down browser; fall back to system.
  }
  return "system";
}

/** Resolve a mode to the concrete theme actually shown. */
export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return mql().matches ? "dark" : "light";
  return mode;
}

/** Write `data-theme` on <html> for the given (or current) mode. */
export function applyTheme(mode: ThemeMode = getThemeMode()): void {
  document.documentElement.dataset.theme = resolveTheme(mode);
}

/** Persist a mode and apply it immediately. */
export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore; we still apply for this session.
  }
  applyTheme(mode);
}

/** Re-apply when the OS theme changes, but only while we are in "system" mode. */
export function watchSystemTheme(): void {
  mql().addEventListener("change", () => {
    if (getThemeMode() === "system") applyTheme("system");
  });
}
