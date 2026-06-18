import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Database } from "better-sqlite3";
import { openDatabase } from "./db/client";
import { HttpError } from "./util";
import { registerActivityRoutes } from "./routes/activities";
import { registerTemplateRoutes } from "./routes/templates";
import { registerAdminRoutes } from "./routes/admin";

/** Single source of truth for the local port (the demo app and portal must match this). */
export const PORT = Number(process.env.PORT ?? 8787);

/** Builds the Fastify app against a given database (tests pass an in-memory db). */
export function buildApp(db: Database): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  // CORS for the local Vite dev origin (the portal is a browser client of the admin routes).
  app.register(cors, {
    origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.code, message: err.message, field: err.field });
    }
    app.log.error(err);
    return reply.status(500).send({ error: "internal", message: "Internal server error." });
  });

  registerTemplateRoutes(app, db);
  registerActivityRoutes(app, db);
  registerAdminRoutes(app, db);

  app.get("/health", (_req, reply) => reply.send({ ok: true }));
  return app;
}

// Entry point: run the server when this file is executed directly.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const db = openDatabase();
  const app = buildApp(db);
  // Bind all interfaces by default so a physical iPhone on the same network can reach the Mac at
  // its LAN IP (the simulator uses localhost, which 0.0.0.0 also covers). Override with HOST.
  const host = process.env.HOST ?? "0.0.0.0";
  app
    .listen({ port: PORT, host })
    .then(() => app.log.info(`LiveStage backend listening on ${host}:${PORT} (reach it at http://<your-mac-ip>:${PORT} from a device)`))
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}
