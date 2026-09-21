/**
 * /api/v1/playlists/* — api.md §7 (endpoint 26–33)
 * ทุก endpoint requireAuth; LibraryError → ERROR_STATUS (NAME_TAKEN 409 / FORBIDDEN 403)
 */
import { z } from "zod";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import {
  apiError,
  ERROR_STATUS,
  type ErrorCode,
  type PlaylistDTO,
} from "@musicplayer/shared";
import { requireAuth } from "../plugins/requireAuth.js";
import { LibraryError } from "../services/LibraryError.js";
import type { PlaylistService } from "../services/PlaylistService.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlaylistRoutesDeps {
  jwtSecret: string;
  playlists: PlaylistService;
}

const createBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});
const patchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
});
const addTracksBody = z.object({
  trackIds: z.array(z.string().regex(UUID_RE)).min(1).max(50),
  position: z.number().int().min(0).optional(),
});
const removeTracksBody = z.object({
  itemIds: z.array(z.string().regex(UUID_RE)).min(1).max(500),
});
const reorderBody = z.object({
  orderedItemIds: z.array(z.string().regex(UUID_RE)).min(1).max(500),
});

type PlaylistReply = PlaylistDTO | { playlists: PlaylistDTO[] };

async function run(
  app: FastifyInstance,
  reply: FastifyReply,
  fn: () => Promise<PlaylistReply | undefined>,
): Promise<void> {
  try {
    const result = await fn();
    if (result !== undefined) reply.status(200).send(result);
    // undefined = caller จัด status/send เอง (204)
  } catch (error) {
    if (error instanceof LibraryError) {
      const status = ERROR_STATUS[error.code as ErrorCode];
      app.log.debug({ err: error }, "playlist command failed");
      return void reply
        .status(status)
        .send(apiError(error.code as ErrorCode, error.message));
    }
    throw error;
  }
}

export const playlistRoutes: FastifyPluginAsync<PlaylistRoutesDeps> = async (
  app,
  deps,
) => {
  app.addHook("preHandler", requireAuth(deps.jwtSecret));

  app.get("/playlists", (request, reply) =>
    run(app, reply, () => deps.playlists.list(request.user!.id)),
  );

  app.post("/playlists", (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "name (1-200 chars) is required"));
    }
    return run(app, reply, async () => {
      const dto = await deps.playlists.create(request.user!.id, parsed.data);
      void reply.status(201).send(dto);
      return undefined;
    });
  });

  app.get("/playlists/:id", (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "playlist id must be a UUID"));
    }
    return run(app, reply, () => deps.playlists.get(request.user!.id, id));
  });

  app.patch("/playlists/:id", (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "playlist id must be a UUID"));
    }
    const parsed = patchBody.safeParse(request.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "name / description required"));
    }
    return run(app, reply, () =>
      deps.playlists.update(request.user!.id, id, parsed.data),
    );
  });

  app.delete("/playlists/:id", (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "playlist id must be a UUID"));
    }
    return run(app, reply, async () => {
      await deps.playlists.remove(request.user!.id, id);
      return void reply.status(204).send();
    });
  });

  app.post("/playlists/:id/tracks", (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "playlist id must be a UUID"));
    }
    const parsed = addTracksBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "trackIds (1-50 uuids) is required"));
    }
    return run(app, reply, () =>
      deps.playlists.addTracks(
        request.user!.id,
        id,
        parsed.data.trackIds,
        parsed.data.position,
      ),
    );
  });

  app.delete("/playlists/:id/tracks", (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "playlist id must be a UUID"));
    }
    const parsed = removeTracksBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "itemIds (1-500 uuids) is required"));
    }
    return run(app, reply, () =>
      deps.playlists.removeTracks(request.user!.id, id, parsed.data.itemIds),
    );
  });

  app.patch("/playlists/:id/tracks/order", (request, reply) => {
    const { id } = request.params as { id: string };
    if (!UUID_RE.test(id)) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "playlist id must be a UUID"));
    }
    const parsed = reorderBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "orderedItemIds (1-500 uuids) is required"));
    }
    return run(app, reply, () =>
      deps.playlists.reorderTracks(request.user!.id, id, parsed.data.orderedItemIds),
    );
  });
};
