/**
 * /api/v1/tracks — api.md §3 (endpoint 7–8)
 * GET /tracks/:id → TrackDTO (404) · GET /tracks?ids=a,b,c (≤ 50) → { tracks }
 */
import { apiError } from "@musicplayer/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/requireAuth.js";
import type { TrackDTO } from "@musicplayer/shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TracksRoutesDeps {
  jwtSecret: string;
  findTrackById: (id: string) => Promise<TrackDTO | null>;
  findTracksByIds: (ids: string[]) => Promise<TrackDTO[]>;
  /** Phase 10 — เติม isLiked; ไม่ส่ง = false เสมอ */
  decorateLiked?: (userId: string, tracks: TrackDTO[]) => Promise<TrackDTO[]>;
}

const idsQuerySchema = z.object({
  ids: z
    .string()
    .transform((s) => s.split(","))
    .pipe(
      z
        .array(z.string().regex(UUID_RE))
        .min(1)
        .max(50)
        .transform((arr) => [...new Set(arr)]),
    ),
});

export const tracksRoutes: FastifyPluginAsync<TracksRoutesDeps> = async (app, deps) => {
  app.addHook("preHandler", requireAuth(deps.jwtSecret));

  app.get("/tracks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) {
      return reply.status(400).send(apiError("VALIDATION_ERROR", "Invalid track id"));
    }
    const track = await deps.findTrackById(id);
    if (!track) {
      return reply.status(404).send(apiError("TRACK_NOT_FOUND", "Track not found"));
    }
    const decorated = deps.decorateLiked
      ? (await deps.decorateLiked(request.user!.id, [track]))[0]
      : track;
    return reply.status(200).send(decorated);
  });

  app.get("/tracks", async (request, reply) => {
    const parsed = idsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(
          apiError(
            "VALIDATION_ERROR",
            "Invalid ids (ต้องเป็น uuid 1–50 ตัว คั่นด้วย ,)",
            z.flattenError(parsed.error),
          ),
        );
    }
    let tracks = await deps.findTracksByIds(parsed.data.ids);
    if (deps.decorateLiked) {
      tracks = await deps.decorateLiked(request.user!.id, tracks);
    }
    return reply.status(200).send({ tracks });
  });
};
