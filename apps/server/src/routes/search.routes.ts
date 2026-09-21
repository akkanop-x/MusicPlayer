import { apiError, ERROR_STATUS, type TrackDTO } from "@musicplayer/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  SEARCH_SOURCES,
  type SearchResult,
  type SearchSource,
} from "../services/SearchService.js";
import { LavalinkError } from "../services/lavalink/errors.js";
import { requireAuth } from "../plugins/requireAuth.js";
import { SearchGuard } from "../security/searchGuard.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(500).default(0),
  source: z
    .enum(Object.keys(SEARCH_SOURCES) as [SearchSource, ...SearchSource[]])
    .default("yt"),
});

export interface SearchRoutesDeps {
  jwtSecret: string;
  search: (
    q: string,
    options?: { source?: SearchSource; limit?: number; offset?: number },
  ) => Promise<SearchResult>;
  /** Phase 10 — เติม isLiked ให้ผลลัพธ์ (database.md: isLiked เติมตอนล็อกอิน); ไม่ส่ง = false เสมอ */
  decorateLiked?: (userId: string, tracks: TrackDTO[]) => Promise<TrackDTO[]>;
}

export const searchRoutes: FastifyPluginAsync<SearchRoutesDeps> = async (app, deps) => {
  app.addHook("preHandler", requireAuth(deps.jwtSecret));
  // api.md §13: /search 30 req/min/user — in-memory พอสำหรับ single instance (Phase 13 ค่อยดู Redis)
  const guard = new SearchGuard(30);

  app.get("/search", async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(
          apiError(
            "VALIDATION_ERROR",
            "Invalid search parameters",
            z.flattenError(parsed.error),
          ),
        );
    }
    const userId = request.user?.id ?? "";
    if (guard.tryAcquire(userId) === "rate-limited") {
      return reply
        .status(ERROR_STATUS.RATE_LIMITED)
        .send(apiError("RATE_LIMITED", "Too many searches, try again in a minute"));
    }

    const { q, limit, offset, source } = parsed.data;
    try {
      const result = await deps.search(q, { source, limit, offset });
      if (deps.decorateLiked) {
        return { ...result, tracks: await deps.decorateLiked(userId, result.tracks) };
      }
      return result;
    } catch (error) {
      if (error instanceof LavalinkError) {
        app.log.error(error, "search upstream failed");
        // fail-soft หมดทาง (library ก็ว่าง) — แจ้งชัดว่า source ไหนใช้ไม่ได้
        return reply.status(503).send(
          apiError("UPSTREAM_UNAVAILABLE", "Search upstream is unavailable", {
            sources: { available: [], degraded: [source] },
          }),
        );
      }
      throw error;
    }
  });
};
