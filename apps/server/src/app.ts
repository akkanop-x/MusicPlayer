import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.routes.js";
import type { Env } from "./config/env.js";

/** สร้าง Fastify instance โดยไม่แตะ DB/network — ใช้ทั้ง boot จริงและ unit test (fastify.inject) */
export function buildApp(env: Pick<Env, "CORS_ORIGIN">): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: env.CORS_ORIGIN ?? true,
  });

  app.register(healthRoutes);

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
