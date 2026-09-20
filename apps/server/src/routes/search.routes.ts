import { apiError } from "@musicplayer/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  SEARCH_SOURCES,
  type SearchResult,
  type SearchSource,
} from "../services/SearchService.js";
import { LavalinkError } from "../services/lavalink/errors.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  source: z
    .enum(Object.keys(SEARCH_SOURCES) as [SearchSource, ...SearchSource[]])
    .default("yt"),
});

export interface SearchRoutesDeps {
  /** เว้น auth guard ไว้ก่อน — ระบบ auth ยังไม่ implement (ทราบชัดใน spec Phase 2) */
  search: (
    q: string,
    options?: { source?: SearchSource; limit?: number },
  ) => Promise<SearchResult>;
}

export const searchRoutes: FastifyPluginAsync<SearchRoutesDeps> = async (app, deps) => {
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

    const { q, limit, source } = parsed.data;
    try {
      return await deps.search(q, { source, limit });
    } catch (error) {
      if (error instanceof LavalinkError) {
        app.log.error(error, "search upstream failed");
        // fail-soft ตาม DoD Phase 2: 503 + error ชัดเจน (ยังไม่มี local library ให้ fallback — Phase 6)
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
