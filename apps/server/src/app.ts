import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
import { authRoutes, type AuthRoutesDeps } from "./routes/auth.routes.js";
import { searchRoutes, type SearchRoutesDeps } from "./routes/search.routes.js";
import { tracksRoutes, type TracksRoutesDeps } from "./routes/tracks.routes.js";
import { streamRoutes, type StreamRoutesDeps } from "./routes/stream.routes.js";
import { playerRoutes, type PlayerRoutesDeps } from "./routes/player.routes.js";
import { queueRoutes } from "./routes/queue.routes.js";
import { recommendationRoutes } from "./routes/recommendation.routes.js";
import { AccountLockout, AuthGuard } from "./security/authGuard.js";
import { CommandGuard } from "./security/commandGuard.js";
import { playlistRoutes } from "./routes/playlist.routes.js";
import { likeRoutes } from "./routes/like.routes.js";
import { historyRoutes } from "./routes/history.routes.js";
import {
  createPlaylistService,
  type PlaylistService,
} from "./services/PlaylistService.js";
import { createLikeService, type LikeService } from "./services/LikeService.js";
import {
  createHistoryService,
  type HistoryService,
} from "./services/HistoryService.js";
import * as playlistRepo from "./repositories/playlist.repo.js";
import * as likesRepo from "./repositories/likes.repo.js";
import * as historyRepo from "./repositories/history.repo.js";
import { eqRoutes } from "./routes/eq.routes.js";
import { healthRoutes } from "./routes/health.routes.js";
import { createSearchService } from "./services/SearchService.js";
import { createStreamService } from "./services/StreamService.js";
import { createAuthService } from "./services/auth/AuthService.js";
import { createPlayerService } from "./services/PlayerService.js";
import {
  createRuleBasedProvider,
  realProviderQueries,
} from "./services/recommendation/ruleBased.js";
import { createEqService, type EqService } from "./services/EqService.js";
import { LavalinkClient } from "./services/lavalink/LavalinkClient.js";
import { ResolverClient } from "./services/resolver/ResolverClient.js";
import {
  updateGenres,
  upsertTrack,
  findTrackById,
  updateStreamMeta,
  searchTracks,
  findTrackDTOs,
} from "./repositories/tracks.repo.js";
import {
  createUser,
  findUserByEmail,
  findUserById,
} from "./repositories/users.repo.js";
import {
  createRefreshToken,
  findRefreshTokenByHash,
  revokeRefreshToken,
  revokeSeries,
} from "./repositories/refreshTokens.repo.js";
import {
  findTrackDTO,
  getUserSettings,
  saveUserSettings,
} from "./repositories/player.repo.js";
import {
  loadQueueSnapshot,
  saveQueueSnapshot,
} from "./repositories/queueSnapshot.repo.js";
import { RealtimeHub } from "./realtime/RealtimeHub.js";
import { attachRealtime } from "./realtime/wsServer.js";

export interface AppDeps {
  /** ไม่ส่งมา = ไม่ register search/auth/stream routes (ใช้ใน test ที่ไม่แตะ DB) */
  db?: Db;
  lavalink?: LavalinkClient;
  resolver?: ResolverClient;
  /** inject ทั้ง service สำหรับ contract test (แทนที่ default ทั้ง lavalink+db) */
  search?: SearchRoutesDeps["search"];
  /** inject ฝั่ง tracks endpoints (contract test) */
  tracks?: Omit<TracksRoutesDeps, "jwtSecret">;
  auth?: AuthRoutesDeps;
  stream?: StreamRoutesDeps;
  player?: PlayerRoutesDeps;
  /** inject service-level repos (WS contract test) — buildApp สร้าง service + แปะ hub ให้เอง */
  playerRepos?: Omit<import("./services/PlayerService.js").PlayerDeps, "broadcaster">;
  /** inject ฝั่ง eq endpoints (contract test) — hub buildApp สร้างเอง */
  eq?: EqService;
  /** inject ฝั่ง library endpoints (Phase 10: playlists/likes/history) — hub ใช้ร่วมกับ player */
  library?: LibraryServices;
  /** inject command guard (contract test ใช้ limit ต่ำ) — ไม่ส่ง = สร้าง 60/min ให้เอง */
  commandGuard?: CommandGuard;
  /** inject ฝั่ง recommendation/radio endpoints (Phase 12 contract test) */
  recommendation?: Omit<
    import("./routes/recommendation.routes.js").RecommendationRoutesDeps,
    "jwtSecret"
  >;
}

/** Phase 10 — services ของ api.md §7–§9 (share hub กับ player สำหรับ LIKES_CHANGED) */
export interface LibraryServices {
  playlists: PlaylistService;
  likes: LikeService;
  history: HistoryService;
}

/** สร้าง Fastify instance — ใช้ทั้ง boot จริงและ unit test (fastify.inject) */
export function buildApp(
  env: Pick<
    Env,
    | "CORS_ORIGIN"
    | "LAVALINK_URL"
    | "LAVALINK_PASSWORD"
    | "RESOLVER_URL"
    | "JWT_SECRET"
    | "REFRESH_SECRET"
  >,
  deps: AppDeps = {},
): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: env.CORS_ORIGIN ?? true,
  });
  // จำเป็นสำหรับอ่าน/เขียน cookie (refresh token — security.md §1, §8.6)
  app.register(cookie);

  // security.md §10 — security headers ทุก response ของ API (CSP ฝั่งเว็บอยู่ที่ nginx)
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    return payload;
  });

  // hub ตัวเดียวต่อ app — player service และ eq routes ใช้ร่วมกัน (version ต่อ user ชุดเดียว)
  const hub = new RealtimeHub();
  // security.md §3 / api.md §12 — rate limits (in-memory MVP; Redis เมื่อ multi-instance)
  const loginGuard = new AuthGuard();
  const lockout = new AccountLockout();
  const commandGuard = deps.commandGuard ?? new CommandGuard();
  // Phase 10 — library services (playlists/likes/history); player ใช้ history.record ผ่าน callback
  const library: LibraryServices | null =
    deps.library ?? (deps.db ? realLibraryServices(deps.db as Db, hub) : null);
  // Phase 11/12 — autoplay + radio ใช้ RuleBasedProvider เต็ม (candidate pool/scoring/
  // genre constraint §2.1.1); interface เดิม (getRadioTracks/getHomeFeed) ไม่เปลี่ยน
  const recommendation = deps.db
    ? createRuleBasedProvider(realProviderQueries(deps.db as Db), {
        log: (message) => app.log.warn({ message }, "recommendation"),
      })
    : null;
  /** player service ตัวเดียวต่อ app — eq routes ใช้ setAutoplay ผ่าน dep */
  let playerService: ReturnType<typeof createPlayerService> | null = null;

  app.register(healthRoutes);

  if (deps.auth || deps.db) {
    const auth = deps.auth
      ? deps.auth
      : { ...realAuthDeps(env, deps.db as Db), loginGuard, lockout };
    app.register(authRoutes, { prefix: "/api/v1", ...auth });
  }

  if (deps.player || deps.playerRepos || deps.db) {
    const player = deps.player
      ? { ...deps.player, commandGuard }
      : ((): PlayerRoutesDeps => {
          if (deps.playerRepos) {
            return {
              jwtSecret: env.JWT_SECRET,
              commandGuard,
              player: createPlayerService({ ...deps.playerRepos, broadcaster: hub }),
            };
          }
          return {
            jwtSecret: env.JWT_SECRET,
            commandGuard,
            player: createPlayerService({
              findTrack: (trackId) => findTrackDTO(deps.db as Db, trackId),
              getSettings: (userId) => getUserSettings(deps.db as Db, userId),
              saveSettings: (userId, patch) =>
                saveUserSettings(deps.db as Db, userId, patch),
              loadQueue: (userId) => loadQueueSnapshot(deps.db as Db, userId),
              saveQueue: (userId, snapshot) =>
                saveQueueSnapshot(deps.db as Db, userId, snapshot),
              onPlaybackEnded: library
                ? (userId, input) => void library.history.record(userId, input)
                : undefined,
              recommend: recommendation
                ? (input) =>
                    recommendation.getRadioTracks(
                      {
                        trackId: input.seedTrackId,
                        userId: input.userId,
                        boostArtists: input.boostArtists,
                      },
                      new Set(input.exclude),
                      input.limit,
                    )
                : undefined,
              broadcaster: hub,
            }),
          };
        })();
    playerService = player.player;
    // websocket.md — Socket.IO บน app.server เดียวกัน, path /ws, room user:{userId}
    // Fastify สร้าง HTTP server จริงตอน listen → attach ใน onListen hook (engine.io
    // ต้อง wrap request listener ของ server ที่ bind แล้วเท่านั้น)
    // onListen hook: instance มาทาง `this` (fastify เรียก fn.call(server) ไม่ส่ง args)
    app.addHook("onListen", async function (this: FastifyInstance) {
      attachRealtime(this, {
        jwtSecret: env.JWT_SECRET,
        player: player.player,
        hub,
      });
    });
    app.register(playerRoutes, { prefix: "/api/v1", ...player });
    // queue routes ใช้ player service อินสแตนซ์เดียวกัน (state ต่อ user ชุดเดียว)
    app.register(queueRoutes, {
      prefix: "/api/v1",
      jwtSecret: player.jwtSecret,
      player: player.player,
      getPlaylistTrackIds: library
        ? (userId, playlistId) => library.playlists.getTrackIds(userId, playlistId)
        : undefined,
      commandGuard,
      // api.md #20 — POST /queue/tracks { radioSeedTrackId } → เริ่ม radio (Phase 12)
      startRadio: playerService
        ? (userId, seedTrackId) => playerService!.startRadio(userId, seedTrackId)
        : undefined,
    });
  }

  if (deps.player || deps.playerRepos || deps.db || deps.recommendation) {
    // api.md §11 — home feed + radio start/extend (Phase 12)
    app.register(recommendationRoutes, {
      prefix: "/api/v1",
      jwtSecret: env.JWT_SECRET,
      commandGuard,
      ...(deps.recommendation ?? {
        getHomeFeed: recommendation
          ? (userId: string, limit: number) => recommendation.getHomeFeed(userId, limit)
          : undefined,
        startRadio: playerService
          ? (userId: string, seedTrackId: string) =>
              playerService!.startRadio(userId, seedTrackId)
          : undefined,
        extendRadio: playerService
          ? (userId: string) => playerService!.extendRadio(userId)
          : undefined,
      }),
    });
  }

  if (library) {
    const jwtSecret = env.JWT_SECRET;
    app.register(playlistRoutes, {
      prefix: "/api/v1",
      jwtSecret,
      playlists: library.playlists,
    });
    app.register(likeRoutes, {
      prefix: "/api/v1",
      jwtSecret,
      likes: library.likes,
    });
    app.register(historyRoutes, {
      prefix: "/api/v1",
      jwtSecret,
      history: library.history,
    });
  }

  if (deps.eq || deps.db) {
    app.register(eqRoutes, {
      prefix: "/api/v1",
      jwtSecret: env.JWT_SECRET,
      eq: deps.eq ?? createEqService(deps.db as Db),
      hub,
      // PATCH /settings { autoplay } → player in-memory settings + broadcast ปุ่มข้าม tab
      onAutoplayChanged: playerService
        ? (userId, enabled) => void playerService!.setAutoplay(userId, enabled)
        : undefined,
    });
  }

  if (deps.stream || deps.db) {
    const stream =
      deps.stream ??
      ((): StreamRoutesDeps => {
        const authService = realAuthService(env, deps.db as Db);
        const streamService = createStreamService({
          findTrackById: (id) => findTrackById(deps.db as Db, id),
          updateStreamMeta: (id, meta) => updateStreamMeta(deps.db as Db, id, meta),
          updateGenres: (id, genres) => updateGenres(deps.db as Db, id, genres),
          resolver: deps.resolver ?? new ResolverClient({ baseUrl: env.RESOLVER_URL }),
        });
        return {
          validateSession: (token) => authService.validateSession(token),
          openStream: (trackId, range) => streamService.openStream(trackId, range),
        };
      })();
    app.register(streamRoutes, { prefix: "/api/v1", ...stream });
  }

  if (deps.search || deps.db) {
    const search =
      deps.search ??
      createSearchService({
        lavalink:
          deps.lavalink ??
          new LavalinkClient({
            baseUrl: env.LAVALINK_URL,
            password: env.LAVALINK_PASSWORD,
          }),
        upsertTrack: (track) => upsertTrack(deps.db as Db, track),
        searchLibrary: (q, limit) => searchTracks(deps.db as Db, q, limit),
      }).search;
    app.register(searchRoutes, {
      prefix: "/api/v1",
      jwtSecret: env.JWT_SECRET,
      search,
      decorateLiked: library
        ? (userId, tracks) => library.likes.decorateTracks(userId, tracks)
        : undefined,
    });
  }

  if (deps.tracks || deps.db) {
    const tracks = deps.tracks ?? {
      findTrackById: (id: string) => findTrackDTO(deps.db as Db, id),
      findTracksByIds: (ids: string[]) => findTrackDTOs(deps.db as Db, ids),
    };
    app.register(tracksRoutes, {
      prefix: "/api/v1",
      jwtSecret: env.JWT_SECRET,
      ...tracks,
      decorateLiked: library
        ? (userId, tracks) => library.likes.decorateTracks(userId, tracks)
        : undefined,
    });
  }

  // central error handler — โครงสร้าง error เดียวตาม backend.md §4 (error shape อยู่ใน packages/shared)
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    app.log.error(error);
    const status =
      typeof error.statusCode === "number" && error.statusCode >= 400
        ? error.statusCode
        : 500;
    void reply.status(status).send({
      error: {
        code: status === 404 ? "NOT_FOUND" : "INTERNAL",
        message: status >= 500 ? "Internal server error" : error.message,
      },
    });
  });

  // Fastify จัดการ 404 ผ่าน not-found handler แยกจาก error handler
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `Route ${request.method}:${request.url} not found`,
      },
    });
  });

  return app;
}

function realLibraryServices(db: Db, hub: RealtimeHub): LibraryServices {
  return {
    playlists: createPlaylistService({
      listPlaylists: (userId) => playlistRepo.listPlaylists(db, userId),
      findPlaylistRow: (id) => playlistRepo.findPlaylistRow(db, id),
      findPlaylistByName: (userId, name) =>
        playlistRepo.findPlaylistByName(db, userId, name),
      createPlaylist: (userId, input) =>
        playlistRepo.createPlaylistRow(db, userId, input),
      updatePlaylist: (id, patch) => playlistRepo.updatePlaylistById(db, id, patch),
      deletePlaylist: (id) => playlistRepo.softDeletePlaylist(db, id),
      listPlaylistItems: (playlistId, userId) =>
        playlistRepo.listPlaylistItems(db, playlistId, userId),
      appendPlaylistTracks: (playlistId, trackIds) =>
        playlistRepo.appendPlaylistTracks(db, playlistId, trackIds),
      removePlaylistItems: (playlistId, itemIds) =>
        playlistRepo.removePlaylistItems(db, playlistId, itemIds),
      reorderPlaylistItems: (playlistId, orderedItemIds) =>
        playlistRepo.reorderPlaylistItems(db, playlistId, orderedItemIds),
      existingTrackIds: (trackIds) => playlistRepo.findExistingTrackIds(db, trackIds),
    }),
    likes: createLikeService(
      {
        likeTrackRow: (userId, trackId) => likesRepo.likeTrackRow(db, userId, trackId),
        unlikeTrackRow: (userId, trackId) =>
          likesRepo.unlikeTrackRow(db, userId, trackId),
        listLikedTracks: (userId, options) =>
          likesRepo.listLikedTracks(db, userId, options),
        likedTrackIds: (userId, trackIds) =>
          likesRepo.likedTrackIds(db, userId, trackIds),
        trackExists: (trackId) => likesRepo.findExistingTrackId(db, trackId),
      },
      hub,
    ),
    history: createHistoryService({
      insertHistoryEntry: (userId, entry) =>
        historyRepo.insertHistoryEntry(db, userId, entry),
      listHistory: (userId, options) => historyRepo.listHistory(db, userId, options),
    }),
  };
}

function realAuthService(env: Pick<Env, "JWT_SECRET">, db: Db) {
  return createAuthService(
    {
      findUserByEmail: (email) => findUserByEmail(db, email),
      findUserById: (id) => findUserById(db, id),
      createUser: (input) => createUser(db, input),
      createRefreshToken: (input) => createRefreshToken(db, input),
      findRefreshTokenByHash: (tokenHash) => findRefreshTokenByHash(db, tokenHash),
      revokeRefreshToken: (id) => revokeRefreshToken(db, id),
      revokeSeries: (seriesId) => revokeSeries(db, seriesId),
    },
    { jwtSecret: env.JWT_SECRET },
  );
}

function realAuthDeps(env: Pick<Env, "JWT_SECRET">, db: Db): AuthRoutesDeps {
  return { ...realAuthService(env, db), jwtSecret: env.JWT_SECRET };
}
