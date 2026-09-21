/**
 * /api/v1/recommendations + /api/v1/radio/* — api.md §11 (endpoint 45–47)
 * GET /recommendations → { tracks } (home feed "แนะนำสำหรับคุณ")
 * POST /radio/start { seedTrackId } → QueueStateDTO (queue ถูกแทนด้วย radio)
 * POST /radio/extend → QueueStateDTO (เติม upcoming; ไม่มี radio → 409 NO_RADIO)
 */
import { z } from "zod";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  apiError,
  ERROR_STATUS,
  type ErrorCode,
  type QueueStateDTO,
  type TrackDTO,
} from "@musicplayer/shared";
import { requireAuth } from "../plugins/requireAuth.js";
import { PlayerError } from "../services/PlayerService.js";

export interface RecommendationRoutesDeps {
  jwtSecret: string;
  /** home feed (RecommendationProvider.getHomeFeed — ไม่ส่ง = ตอบ []) */
  getHomeFeed?: (userId: string, limit: number) => Promise<TrackDTO[]>;
  startRadio?: (userId: string, seedTrackId: string) => Promise<QueueStateDTO>;
  extendRadio?: (userId: string) => Promise<QueueStateDTO>;
  /** api.md §12 — radio start/extend นับเป็น command 60/min/user */
  commandGuard?: { tryAcquire(userId: string): "ok" | "rate-limited" };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const startBody = z.object({ seedTrackId: z.string().regex(UUID_RE) });
const DEFAULT_HOME_LIMIT = 20;
const MAX_HOME_LIMIT = 50;

export const recommendationRoutes: FastifyPluginAsync<
  RecommendationRoutesDeps
> = async (app, deps) => {
  app.addHook("preHandler", requireAuth(deps.jwtSecret));
  if (deps.commandGuard) {
    app.addHook("preHandler", async (request, reply) => {
      if (request.method === "GET") return;
      if (deps.commandGuard!.tryAcquire(request.user!.id) === "rate-limited") {
        return reply
          .status(ERROR_STATUS.RATE_LIMITED)
          .send(apiError("RATE_LIMITED", "Too many radio commands"));
      }
    });
  }

  app.get("/recommendations", async (request, reply) => {
    const raw = Number((request.query as { limit?: string }).limit ?? "");
    const limit =
      Number.isFinite(raw) && raw > 0
        ? Math.min(Math.floor(raw), MAX_HOME_LIMIT)
        : DEFAULT_HOME_LIMIT;
    let tracks: TrackDTO[] = [];
    try {
      tracks = deps.getHomeFeed ? await deps.getHomeFeed(request.user!.id, limit) : [];
    } catch (error) {
      // fail-soft (recommendation.md §9): home feed พัง → ตอบ empty ไม่ใช่ 5xx
      app.log.warn({ err: error }, "home feed failed");
    }
    return void reply.status(200).send({ tracks });
  });

  const radioRun = async (
    reply: FastifyReply,
    fn: () => Promise<QueueStateDTO>,
  ): Promise<void> => {
    try {
      return void reply.status(200).send(await fn());
    } catch (error) {
      if (error instanceof PlayerError) {
        const status = ERROR_STATUS[error.code as ErrorCode];
        app.log.debug({ err: error }, "radio command failed");
        return void reply
          .status(status)
          .send(apiError(error.code as ErrorCode, error.message));
      }
      throw error;
    }
  };

  app.post("/radio/start", (request, reply) => {
    const parsed = startBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "seedTrackId (uuid) is required"));
    }
    if (!deps.startRadio) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "radio is not available"));
    }
    return radioRun(reply, () =>
      deps.startRadio!(request.user!.id, parsed.data.seedTrackId),
    );
  });

  app.post("/radio/extend", (request, reply) => {
    if (!deps.extendRadio) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "radio is not available"));
    }
    return radioRun(reply, () => deps.extendRadio!(request.user!.id));
  });
};
