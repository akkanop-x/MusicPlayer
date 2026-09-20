import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
import { authRoutes, type AuthRoutesDeps } from "./routes/auth.routes.js";
import { searchRoutes, type SearchRoutesDeps } from "./routes/search.routes.js";
import { streamRoutes, type StreamRoutesDeps } from "./routes/stream.routes.js";
import { healthRoutes } from "./routes/health.routes.js";
import { createSearchService } from "./services/SearchService.js";
import { createStreamService } from "./services/StreamService.js";
import { createAuthService } from "./services/auth/AuthService.js";
import { createSpotifyWebApiService } from "./services/SpotifyWebApiService.js";
import { LavalinkClient } from "./services/lavalink/LavalinkClient.js";
import { ResolverClient } from "./services/resolver/ResolverClient.js";
import {
  updateGenres,
  upsertTrack,
  findTrackById,
  updateStreamMeta,
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

export interface AppDeps {
  /** ไม่ส่งมา = ไม่ register search/auth/stream routes (ใช้ใน test ที่ไม่แตะ DB) */
  db?: Db;
  lavalink?: LavalinkClient;
  resolver?: ResolverClient;
  /** inject ทั้ง service สำหรับ contract test (แทนที่ default ทั้ง lavalink+db) */
  search?: SearchRoutesDeps["search"];
  auth?: AuthRoutesDeps;
  stream?: StreamRoutesDeps;
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
    | "SPOTIFY_CLIENT_ID"
    | "SPOTIFY_CLIENT_SECRET"
  >,
  deps: AppDeps = {},
): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: env.CORS_ORIGIN ?? true,
  });
  // จำเป็นสำหรับอ่าน/เขียน cookie (refresh token — security.md §1, §8.6)
  app.register(cookie);

  app.register(healthRoutes);

  if (deps.auth || deps.db) {
    const auth = deps.auth ?? realAuthDeps(env, deps.db as Db);
    app.register(authRoutes, { prefix: "/api/v1", ...auth });
  }

  if (deps.stream || deps.db) {
    const stream =
      deps.stream ??
      ((): StreamRoutesDeps => {
        const authService = realAuthService(env, deps.db as Db);
        const streamService = createStreamService({
          findTrackById: (id) => findTrackById(deps.db as Db, id),
          updateStreamMeta: (id, meta) => updateStreamMeta(deps.db as Db, id, meta),
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
        enrichGenres: (trackId, artist) =>
          enrichGenre(deps.db as Db, env, trackId, artist),
      }).search;
    app.register(searchRoutes, { prefix: "/api/v1", search });
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

/** genre enrichment จาก Spotify Web API — fail-soft (ไม่มี credentials → ไม่ทำอะไร) */
async function enrichGenre(
  db: Db,
  env: Pick<Env, "SPOTIFY_CLIENT_ID" | "SPOTIFY_CLIENT_SECRET">,
  trackId: string,
  artist: string,
): Promise<void> {
  const spotify = createSpotifyWebApiService({
    clientId: env.SPOTIFY_CLIENT_ID,
    clientSecret: env.SPOTIFY_CLIENT_SECRET,
  });
  const genres = await spotify.artistGenres(artist);
  if (genres.length > 0) await updateGenres(db, trackId, genres);
}
