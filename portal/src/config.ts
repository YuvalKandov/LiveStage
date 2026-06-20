// Portal configuration. Two distinct auth planes (build spec §12), neither a real secret here:
//
//  - ADMIN_TOKEN: the local-demo admin token for the /v1/admin routes (sessions, logs, the typed
//    update form, and in later checkpoints projects/keys/templates). A single shared secret is not a
//    real auth plane; it only keeps the admin surface separate from the key planes for the demo.
//  - SERVICE_KEY: a `service` key for the read-only Insights API (/v1/insights/*), which is
//    service-key gated and rejects mobile keys. The dashboard sends this as a Bearer token, so it
//    genuinely exercises the gate (it does not proxy Insights through the admin plane).
//
// The active service key is resolved at call time as: localStorage override (set on the Projects &
// keys screen in CP4) -> VITE_SERVICE_KEY here. Until CP4 adds in-UI key generation, point
// VITE_SERVICE_KEY at the seeded service key (backend/.seeded-keys.json) for a zero-friction default.
// Override any of these via Vite env vars (VITE_API_BASE, VITE_ADMIN_TOKEN, VITE_SERVICE_KEY).
export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
export const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? "dev-admin-token";
export const SERVICE_KEY = import.meta.env.VITE_SERVICE_KEY ?? "";

/** localStorage key under which the Projects & keys screen (CP4) stores a generated service key. */
export const SERVICE_KEY_STORAGE = "livestage.serviceKey";

/** The service key the dashboard should use: a localStorage override first, else config. */
export function activeServiceKey(): string {
  try {
    const stored = localStorage.getItem(SERVICE_KEY_STORAGE);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    // localStorage can throw in locked-down browsers; fall back to config.
  }
  return SERVICE_KEY;
}
