/**
 * /api/v1/likes + /tracks/:id/like — api.md §8 (endpoint 34–36)
 * GET /likes (cursor pagination), PUT/DELETE /tracks/:id/like (idempotent)
 */
import { z } from "zod";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { apiError, ERROR_STATUS, type ErrorCode } from "@musicplayer/shared";
import { requireAuth } from "../plugins/requireAuth.js";
import { LibraryError } from "../services/LibraryError.js";
import type { LikeService } from "../services/LikeService.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LikeRoutesDeps {
  jwtSecret: string;
  likes: LikeService;
}

async function run(
  app: FastifyInstance,
  reply: FastifyReply,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    return void reply.status(200).send(await fn());
  } catch (error) {
    if (error instanceof LibraryError) {
      const status = ERROR_STATUS[error.code as ErrorCode];
      app.log.debug({ err: error }, "like command failed");
      return void reply
        .status(status)
        .send(apiError(error.code as ErrorCode, error.message));
    }
    throw error;
  }
}

export const likeRoutes: FastifyPluginAsync<LikeRoutesDeps> = async (app, deps) => {
  app.addHook("preHandler", requireAuth(deps.jwtSecret));

  const listQuery = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  });

  app.get("/likes", (request, reply) => {
    const parsed = listQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "limit (1-200) / cursor only"));
    }
    return run(app, reply, () => deps.likes.list(request.user!.id, parsed.data));
  });

  app.put("/tracks/:id/like", (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "track id must be a UUID"));
    }
    return run(app, reply, () => deps.likes.like(request.user!.id, id));
  });

  app.delete("/tracks/:id/like", (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "track id must be a UUID"));
    }
    return run(app, reply, () => deps.likes.unlike(request.user!.id, id));
  });
};
