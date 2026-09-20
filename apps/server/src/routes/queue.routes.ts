/**
 * /api/v1/queue/* — api.md §5 (endpoint 19–24) + PATCH /player/shuffle (#18)
 * ทุก endpoint requireAuth และคืน QueueStateDTO ทุกครั้ง (ไม่รอ WS)
 */
import { z } from "zod";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import {
  apiError,
  ERROR_STATUS,
  type ErrorCode,
  type PlayerStateDTO,
  type QueueStateDTO,
} from "@musicplayer/shared";
import { requireAuth } from "../plugins/requireAuth.js";
import { PlayerError, type PlayerService } from "../services/PlayerService.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QueueRoutesDeps {
  jwtSecret: string;
  player: PlayerService;
}

const trackIdsBody = z.object({
  trackIds: z.array(z.string().regex(UUID_RE)).min(1).max(50),
});
const moveBody = z.object({ toPosition: z.number().int().min(0) });

async function run(
  app: FastifyInstance,
  reply: FastifyReply,
  fn: () => Promise<QueueStateDTO | PlayerStateDTO>,
): Promise<void> {
  try {
    return void reply.status(200).send(await fn());
  } catch (error) {
    if (error instanceof PlayerError) {
      const status = ERROR_STATUS[error.code as ErrorCode];
      app.log.debug({ err: error }, "queue command failed");
      return void reply
        .status(status)
        .send(apiError(error.code as ErrorCode, error.message));
    }
    throw error;
  }
}

export const queueRoutes: FastifyPluginAsync<QueueRoutesDeps> = async (app, deps) => {
  app.addHook("preHandler", requireAuth(deps.jwtSecret));

  app.get("/queue", (request, reply) =>
    run(app, reply, () => deps.player.getQueue(request.user!.id)),
  );

  app.post("/queue/tracks", (request, reply) => {
    const parsed = trackIdsBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "trackIds (1-50 uuids) is required"));
    }
    return run(app, reply, () =>
      deps.player.addToQueue(request.user!.id, parsed.data.trackIds),
    );
  });

  app.post("/queue/tracks/next", (request, reply) => {
    const parsed = trackIdsBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "trackIds (1-50 uuids) is required"));
    }
    return run(app, reply, () =>
      deps.player.addNextToQueue(request.user!.id, parsed.data.trackIds),
    );
  });

  app.patch("/queue/items/:id/move", (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "item id must be a UUID"));
    }
    const parsed = moveBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "toPosition (integer >= 0) is required"));
    }
    return run(app, reply, () =>
      deps.player.moveQueueItem(request.user!.id, id, parsed.data.toPosition),
    );
  });

  app.delete("/queue/items/:id", (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "item id must be a UUID"));
    }
    return run(app, reply, () => deps.player.removeQueueItem(request.user!.id, id));
  });

  app.delete("/queue", (request, reply) => {
    const scope = (request.query as { scope?: string }).scope ?? "upcoming";
    if (scope !== "upcoming" && scope !== "all") {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "scope must be upcoming|all"));
    }
    return run(app, reply, () => deps.player.clear(request.user!.id, scope));
  });
};
