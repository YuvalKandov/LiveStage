// Portal configuration. The admin token is LOCAL-DEMO-ONLY: a single shared secret is not a real
// auth plane (build spec §12). It only keeps the admin surface distinct from the mobile/service key
// planes for the demo. Override via Vite env vars (VITE_API_BASE, VITE_ADMIN_TOKEN) if needed.
export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
export const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? "dev-admin-token";
