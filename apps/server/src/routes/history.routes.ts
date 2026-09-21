/**
 * /api/v1/history — api.md §9 (endpoint 37) — cursor pagination (?limit&before=ISO)
 * ไม่มี POST /history — เขียนโดย backend จาก playback events (HistoryService.record)
 */
import { z } from "zod";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { apiError, ERROR_STATUS, type ErrorCode } from "@musicplayer/shared";
import { requireAuth } from "../plugins/requireAuth.js";
import { LibraryError } from "../services/LibraryError.js";
import type { HistoryService } from "../services/HistoryService.js";

export interface HistoryRoutesDeps {
  jwtSecret: string;
  history: HistoryService;
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
      app.log.debug({ err: error }, "history query failed");
      return void reply
        .status(status)
        .send(apiError(error.code as ErrorCode, error.message));
    }
    throw error;
  }
}

export const historyRoutes: FastifyPluginAsync<HistoryRoutesDeps> = async (
  app,
  deps,
) => {
  app.addHook("preHandler", requireAuth(deps.jwtSecret));

  const listQuery = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    before: z.string().optional(),
  });

  app.get("/history", (request, reply) => {
    const parsed = listQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "limit (1-200) / before (ISO) only"));
    }
    return run(app, reply, () => deps.history.list(request.user!.id, parsed.data));
  });
};
