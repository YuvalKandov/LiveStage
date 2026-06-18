import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { requireMobileKey } from "../auth/middleware";
import { getTemplate } from "../repo";

export function registerTemplateRoutes(app: FastifyInstance, db: Database): void {
  // GET /v1/templates/:templateId — the config the SDK's fetchConfiguration uses (build spec §8.3).
  app.get("/v1/templates/:templateId", (req, reply) => {
    const key = requireMobileKey(db, req);
    const { templateId } = req.params as { templateId: string };
    return reply.send(getTemplate(db, key.projectId, templateId));
  });
}
