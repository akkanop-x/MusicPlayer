/**
 * Library contract tests — api.md §7/§8/§9 routes (hermetic: inject mock services)
 * ครอบ: 401 ไม่มี token, POST /playlists 201, error mapping (409/403/404/400),
 * PUT/DELETE like shape, GET /history, POST /queue/tracks { playlistId } → resolve
 */
import { beforeEach, describe, expect, it } from "vitest";
import { signJwt } from "../services/auth/jwt.js";
import { buildApp, type AppDeps } from "../app.js";
import { LibraryError } from "../services/LibraryError.js";
import type { PlaylistService } from "../services/PlaylistService.js";
import type { LikeService } from "../services/LikeService.js";
import type { HistoryService } from "../services/HistoryService.js";
import type { PlayerService } from "../services/PlayerService.js";
import type { PlaylistDTO, TrackDTO } from "@musicplayer/shared";

const JWT_SECRET = "test-jwt-secret-with-32-chars-min!!";
const ENV = {
  CORS_ORIGIN: undefined,
  LAVALINK_URL: "http://unused",
  LAVALINK_PASSWORD: "x",
  RESOLVER_URL: "http://unused",
  JWT_SECRET,
  REFRESH_SECRET: "refresh-secret",
} as const;

const PLAYLIST_ID = "00000000-0000-4000-8000-00000000aaaa";
const TRACK_ID = "00000000-0000-4000-8000-00000000bbbb";
const UUID_OK = "00000000-0000-4000-8000-00000000cccc";
const UUID_GHOST = "00000000-0000-4000-8000-00000000f000";

function playlistDto(overrides: Partial<PlaylistDTO> = {}): PlaylistDTO {
  return {
    id: PLAYLIST_ID,
    name: "Mix",
    description: null,
    coverUrl: null,
    trackCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function track(id: string): TrackDTO {
  return {
    id,
    title: "T",
    artist: "A",
    album: null,
    durationMs: 1_000,
    isStream: false,
    isSeekable: true,
    artworkUrl: null,
    sourceName: "youtube",
    isLiked: false,
  };
}

/** mock services — semantics จริงอยู่ที่ LibraryServices.test.ts / PlaylistService.test.ts */
function makeMocks() {
  const playlistService: PlaylistService = {
    async list() {
      return { playlists: [playlistDto()] };
    },
    async get() {
      return playlistDto({
        trackCount: 1,
        tracks: [track(TRACK_ID)],
        itemIds: [UUID_OK],
      });
    },
    async create() {
      return playlistDto({ name: "New" });
    },
    async update(_userId, _id, patch) {
      if (patch.name === "taken") throw new LibraryError("NAME_TAKEN", "dup");
      return playlistDto({ name: patch.name ?? "Mix" });
    },
    async remove(_userId, id) {
      if (id === "00000000-0000-4000-8000-00000000dead") {
        throw new LibraryError("FORBIDDEN", "not your playlist");
      }
    },
    async addTracks(_userId, _id, trackIds) {
      if (trackIds.includes(UUID_GHOST))
        throw new LibraryError("TRACK_NOT_FOUND", "404");
      return playlistDto({ trackCount: trackIds.length });
    },
    async removeTracks(_userId, _id, itemIds) {
      if (itemIds.some((i) => i === "ghost"))
        throw new LibraryError("VALIDATION_ERROR", "bad");
      return playlistDto();
    },
    async reorderTracks(_userId, _id, ids) {
      if (ids.length !== 1) throw new LibraryError("VALIDATION_ERROR", "bad");
      return playlistDto();
    },
    async getTrackIds(_userId, id) {
      if (id === PLAYLIST_ID) return [TRACK_ID, UUID_OK];
      throw new LibraryError("NOT_FOUND", "no playlist");
    },
  };
  const likeService: LikeService = {
    async list() {
      return {
        items: [
          {
            track: { ...track(TRACK_ID), isLiked: true },
            likedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        nextCursor: null,
      };
    },
    async like(_userId, trackId) {
      if (trackId === "ghost") throw new LibraryError("TRACK_NOT_FOUND", "404");
      return { trackId, liked: true as const };
    },
    async unlike(_userId, trackId) {
      return { trackId, liked: false as const };
    },
    async decorateTracks(_userId, tracks) {
      return tracks;
    },
  };
  const historyService: HistoryService = {
    async list(_userId, query) {
      if (query.before === "junk")
        throw new LibraryError("VALIDATION_ERROR", "bad before");
      return {
        items: [
          {
            id: "h1",
            track: track(TRACK_ID),
            playedAt: "2026-01-01T00:00:00.000Z",
            msPlayed: 30_000,
            completed: true,
            skipped: false,
          },
        ],
        nextCursor: null,
      };
    },
    async record() {
      return undefined;
    },
  };
  const player = {
    async getQueue() {
      return { current: null, upcoming: [], history: [], version: 1 };
    },
    async addToQueue(_userId: string, trackIds: string[]) {
      return {
        current: null,
        upcoming: trackIds.map((id) => ({ id: `q-${id}`, track: track(id) })),
        history: [],
        version: 2,
      };
    },
  } as unknown as PlayerService;
  return { playlistService, likeService, historyService, player };
}

describe("library routes (api.md §7–§9)", () => {
  let app: ReturnType<typeof buildApp>;
  let token: string;
  let deps: AppDeps;

  beforeEach(() => {
    const mocks = makeMocks();
    deps = {
      player: { jwtSecret: JWT_SECRET, player: mocks.player },
      library: {
        playlists: mocks.playlistService,
        likes: mocks.likeService,
        history: mocks.historyService,
      },
    };
    app = buildApp(ENV, deps);
    token = signJwt("user-1", JWT_SECRET, 60_000);
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("401 เมื่อไม่มี Bearer", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/playlists" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /playlists → { playlists } (api.md #26)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/playlists",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().playlists[0].id).toBe(PLAYLIST_ID);
  });

  it("POST /playlists → 201 + body invalid → 400 (api.md #27)", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/playlists",
      headers: auth(),
      payload: { name: "New" },
    });
    expect(ok.statusCode).toBe(201);
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/playlists",
      headers: auth(),
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
  });

  it("GET /playlists/:id → tracks + itemIds; id ไม่ใช่ UUID → 400 (api.md #28)", async () => {
    const ok = await app.inject({
      method: "GET",
      url: `/api/v1/playlists/${PLAYLIST_ID}`,
      headers: auth(),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().tracks[0].id).toBe(TRACK_ID);
    expect(ok.json().itemIds[0]).toBe(UUID_OK);
    const bad = await app.inject({
      method: "GET",
      url: "/api/v1/playlists/junk",
      headers: auth(),
    });
    expect(bad.statusCode).toBe(400);
  });

  it("PATCH /playlists/:id — NAME_TAKEN → 409 (api.md #29)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/playlists/${PLAYLIST_ID}`,
      headers: auth(),
      payload: { name: "taken" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NAME_TAKEN");
  });

  it("DELETE /playlists/:id → 204 + FORBIDDEN → 403 (api.md #30)", async () => {
    const ok = await app.inject({
      method: "DELETE",
      url: `/api/v1/playlists/${PLAYLIST_ID}`,
      headers: auth(),
    });
    expect(ok.statusCode).toBe(204);
    const forbidden = await app.inject({
      method: "DELETE",
      url: "/api/v1/playlists/00000000-0000-4000-8000-00000000dead",
      headers: auth(),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("POST /playlists/:id/tracks — TRACK_NOT_FOUND → 404 (api.md #31)", async () => {
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/playlists/${PLAYLIST_ID}/tracks`,
      headers: auth(),
      payload: { trackIds: [UUID_GHOST] },
    });
    expect(bad.statusCode).toBe(404);
    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/playlists/${PLAYLIST_ID}/tracks`,
      headers: auth(),
      payload: { trackIds: [] },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("DELETE /playlists/:id/tracks + PATCH order — VALIDATION_ERROR → 400 (api.md #32/#33)", async () => {
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/playlists/${PLAYLIST_ID}/tracks`,
      headers: auth(),
      payload: { itemIds: ["ghost"] },
    });
    expect(del.statusCode).toBe(400);
    const order = await app.inject({
      method: "PATCH",
      url: `/api/v1/playlists/${PLAYLIST_ID}/tracks/order`,
      headers: auth(),
      payload: { orderedItemIds: [UUID_OK, UUID_OK] },
    });
    expect(order.statusCode).toBe(400);
  });

  it("GET /likes → { items, nextCursor } (api.md #34)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/likes",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].track.isLiked).toBe(true);
  });

  it("PUT/DELETE /tracks/:id/like → { trackId, liked } (api.md #35/#36)", async () => {
    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/tracks/${TRACK_ID}/like`,
      headers: auth(),
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ trackId: TRACK_ID, liked: true });
    const put404 = await app.inject({
      method: "PUT",
      url: "/api/v1/tracks/ghost/like",
      headers: auth(),
    });
    expect(put404.statusCode).toBe(400); // uuid invalid ก่อนถึง service
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/tracks/${TRACK_ID}/like`,
      headers: auth(),
    });
    expect(del.json()).toEqual({ trackId: TRACK_ID, liked: false });
  });

  it("GET /history — before ไม่ใช่ ISO → 400 (api.md #37)", async () => {
    const ok = await app.inject({
      method: "GET",
      url: "/api/v1/history",
      headers: auth(),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().items[0].completed).toBe(true);
    const bad = await app.inject({
      method: "GET",
      url: "/api/v1/history?before=junk",
      headers: auth(),
    });
    expect(bad.statusCode).toBe(400);
  });

  it("POST /queue/tracks { playlistId } — resolve ตามลำดับ playlist (api.md #20)", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/queue/tracks",
      headers: auth(),
      payload: { playlistId: PLAYLIST_ID },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().upcoming.map((i: { track: TrackDTO }) => i.track.id)).toEqual([
      TRACK_ID,
      UUID_OK,
    ]);
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/queue/tracks",
      headers: auth(),
      payload: { playlistId: "00000000-0000-4000-8000-00000000dead" },
    });
    expect(missing.statusCode).toBe(404);
  });
});
