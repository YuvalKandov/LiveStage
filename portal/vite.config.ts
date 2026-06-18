import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server on 5173 (the backend CORS allows localhost origins). The portal calls the backend
// admin routes directly; see src/config.ts for the base URL + local-demo admin token.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
