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
import { eqRoutes } from "./routes/eq.routes.js";
import { healthRoutes } from "./routes/health.routes.js";
import { createSearchService } from "./services/SearchService.js";
import { createStreamService } from "./services/StreamService.js";
import { createAuthService } from "./services/auth/AuthService.js";
import { createPlayerService } from "./services/PlayerService.js";
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

  // hub ตัวเดียวต่อ app — player service และ eq routes ใช้ร่วมกัน (version ต่อ user ชุดเดียว)
  const hub = new RealtimeHub();

  app.register(healthRoutes);

  if (deps.auth || deps.db) {
    const auth = deps.auth ?? realAuthDeps(env, deps.db as Db);
    app.register(authRoutes, { prefix: "/api/v1", ...auth });
  }

  if (deps.player || deps.playerRepos || deps.db) {
    const player =
      deps.player ??
      ((): PlayerRoutesDeps => {
        if (deps.playerRepos) {
          return {
            jwtSecret: env.JWT_SECRET,
            player: createPlayerService({ ...deps.playerRepos, broadcaster: hub }),
          };
        }
        return {
          jwtSecret: env.JWT_SECRET,
          player: createPlayerService({
            findTrack: (trackId) => findTrackDTO(deps.db as Db, trackId),
            getSettings: (userId) => getUserSettings(deps.db as Db, userId),
            saveSettings: (userId, patch) =>
              saveUserSettings(deps.db as Db, userId, patch),
            loadQueue: (userId) => loadQueueSnapshot(deps.db as Db, userId),
            saveQueue: (userId, snapshot) =>
              saveQueueSnapshot(deps.db as Db, userId, snapshot),
            broadcaster: hub,
          }),
        };
      })();
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
    });
  }

  if (deps.eq || deps.db) {
    app.register(eqRoutes, {
      prefix: "/api/v1",
      jwtSecret: env.JWT_SECRET,
      eq: deps.eq ?? createEqService(deps.db as Db),
      hub,
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
