import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
import { searchRoutes, type SearchRoutesDeps } from "./routes/search.routes.js";
import { healthRoutes } from "./routes/health.routes.js";
import { createSearchService } from "./services/SearchService.js";
import { LavalinkClient } from "./services/lavalink/LavalinkClient.js";
import { upsertTrack } from "./repositories/tracks.repo.js";

export interface AppDeps {
  /** ไม่ส่งมา = ไม่ register search routes (ใช้ใน test ที่ไม่แตะ DB) */
  db?: Db;
  lavalink?: LavalinkClient;
  /** inject ทั้ง service สำหรับ contract test (แทนที่ default ทั้ง lavalink+db) */
  search?: SearchRoutesDeps["search"];
}

/** สร้าง Fastify instance — ใช้ทั้ง boot จริงและ unit test (fastify.inject) */
export function buildApp(
  env: Pick<Env, "CORS_ORIGIN" | "LAVALINK_URL" | "LAVALINK_PASSWORD">,
  deps: AppDeps = {},
): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: env.CORS_ORIGIN ?? true,
  });

  app.register(healthRoutes);

  if (deps.search || deps.db) {
    const search =
      deps.search ??
      createSearchService({
        lavalink:
          deps.lavalink ??
          new LavalinkClient({
            baseUrl: env.LAVALINK_URL,
            password: env.LAVALINK_PASSWORD,
          }),
        upsertTrack: (track) => upsertTrack(deps.db as Db, track),
      }).search;
    app.register(searchRoutes, { prefix: "/api/v1", search });
  }

  // central error handler — โครงสร้าง error เดียวตาม backend.md §4 (error shape อยู่ใน packages/shared)
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    app.log.error(error);
    const status =
      typeof error.statusCode === "number" && error.statusCode >= 400
        ? error.statusCode
        : 500;
    void reply.status(status).send({
      error: {
        code: status === 404 ? "NOT_FOUND" : "INTERNAL",
        message: status >= 500 ? "Internal server error" : error.message,
      },
    });
  });

  // Fastify จัดการ 404 ผ่าน not-found handler แยกจาก error handler
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `Route ${request.method}:${request.url} not found`,
      },
    });
  });

  return app;
}
