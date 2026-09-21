/**
 * /api/v1/player/* — api.md §4 (endpoint 9–18 รวม shuffle)
 * ทุก endpoint ใช้ Bearer (requireAuth) — คืน PlayerStateDTO/QueueStateDTO ทุกครั้ง
 * เพื่อให้ client sync ได้ทันทีโดยไม่ต้องรอ WS (player.md §5 #6)
 */
import { z } from "zod";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import {
  apiError,
  ERROR_STATUS,
  REPEAT_MODES,
  type ErrorCode,
  type PlayerStateDTO,
  type QueueStateDTO,
} from "@musicplayer/shared";
import { requireAuth } from "../plugins/requireAuth.js";
import { PlayerError, type PlayerService } from "../services/PlayerService.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlayerRoutesDeps {
  jwtSecret: string;
  player: PlayerService;
  /** api.md §12 — player commands 60/min/user (GET ไม่นับ; ไม่ส่ง = ไม่จำกัด) */
  commandGuard?: { tryAcquire(userId: string): "ok" | "rate-limited" };
}

const playBody = z.object({ trackId: z.string().regex(UUID_RE) });
const seekBody = z.object({ positionMs: z.number().int().min(0) });
const volumeBody = z.object({ volume: z.number().int().min(0).max(100) });
const repeatBody = z.object({ mode: z.enum(REPEAT_MODES) });
const shuffleBody = z.object({ enabled: z.boolean() });
// reason="completed" = เพลงจบเอง (client ยิงตอน ended — repeat=one จะ replay ตาม queue.md §5)
const skipBody = z.object({ reason: z.enum(["completed", "skip"]).optional() });

function toHttp(error: unknown): { status: number; body: ReturnType<typeof apiError> } {
  if (error instanceof PlayerError) {
    const status = ERROR_STATUS[error.code as ErrorCode];
    return { status, body: apiError(error.code as ErrorCode, error.message) };
  }
  throw error;
}

async function run(
  app: FastifyInstance,
  reply: FastifyReply,
  fn: () => Promise<PlayerStateDTO | QueueStateDTO>,
): Promise<void> {
  try {
    const dto = await fn();
    return void reply.status(200).send(dto);
  } catch (error) {
    const { status, body } = toHttp(error);
    app.log.debug({ err: error }, "player command failed");
    return void reply.status(status).send(body);
  }
}

export const playerRoutes: FastifyPluginAsync<PlayerRoutesDeps> = async (app, deps) => {
  app.addHook("preHandler", requireAuth(deps.jwtSecret));
  if (deps.commandGuard) {
    // api.md §12 — command rate limit ต่อ user (GET/status ไม่นับ)
    app.addHook("preHandler", async (request, reply) => {
      if (request.method === "GET") return;
      if (deps.commandGuard!.tryAcquire(request.user!.id) === "rate-limited") {
        return reply
          .status(ERROR_STATUS.RATE_LIMITED)
          .send(apiError("RATE_LIMITED", "Too many player commands"));
      }
    });
  }

  app.get("/player", (_request, reply) =>
    run(app, reply, () => deps.player.getState(_request.user!.id)),
  );

  app.post("/player/play", (request, reply) => {
    const parsed = playBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "trackId (uuid) is required"));
    }
    return run(app, reply, () =>
      deps.player.play(request.user!.id, parsed.data.trackId),
    );
  });

  app.post("/player/pause", (request, reply) =>
    run(app, reply, () => deps.player.pause(request.user!.id)),
  );

  app.post("/player/resume", (request, reply) =>
    run(app, reply, () => deps.player.resume(request.user!.id)),
  );

  app.post("/player/seek", (request, reply) => {
    const parsed = seekBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "positionMs (integer >= 0) is required"));
    }
    return run(app, reply, () =>
      deps.player.seek(request.user!.id, parsed.data.positionMs),
    );
  });

  app.post("/player/skip", (request, reply) => {
    const parsed = skipBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "reason must be completed|skip"));
    }
    return run(app, reply, () =>
      deps.player.skip(request.user!.id, parsed.data.reason ?? "skip"),
    );
  });

  app.post("/player/previous", (request, reply) =>
    run(app, reply, () => deps.player.previous(request.user!.id)),
  );

  app.patch("/player/volume", (request, reply) => {
    const parsed = volumeBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "volume must be 0-100"));
    }
    return run(app, reply, () =>
      deps.player.setVolume(request.user!.id, parsed.data.volume),
    );
  });

  app.patch("/player/repeat", (request, reply) => {
    const parsed = repeatBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(
          apiError("VALIDATION_ERROR", `mode must be one of ${REPEAT_MODES.join("|")}`),
        );
    }
    return run(app, reply, () =>
      deps.player.setRepeatMode(request.user!.id, parsed.data.mode),
    );
  });

  // api.md §4 #18 — shuffle คืน QueueStateDTO (queue.md §4: สลับเฉพาะ upcoming)
  app.patch("/player/shuffle", (request, reply) => {
    const parsed = shuffleBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "enabled (boolean) is required"));
    }
    return run(app, reply, () =>
      deps.player.setShuffleEnabled(request.user!.id, parsed.data.enabled),
    );
  });
};
