/**
 * recommendation/radio routes — api.md §11 (endpoint 45–47)
 * GET /recommendations (home feed, fail-soft), POST /radio/start, POST /radio/extend
 */
import { describe, expect, it } from "vitest";
import { signJwt } from "../services/auth/jwt.js";
import { buildApp } from "../app.js";
import { PlayerError } from "../services/PlayerService.js";
import type { RecommendationRoutesDeps } from "./recommendation.routes.js";
import type { TrackDTO } from "@musicplayer/shared";

const T1: TrackDTO = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Seed Song",
  artist: "Artist",
  album: null,
  durationMs: 213_000,
  isStream: false,
  isSeekable: true,
  artworkUrl: null,
  sourceName: "youtube",
  isLiked: false,
};
const R1: TrackDTO = {
  ...T1,
  id: "22222222-2222-2222-2222-222222222222",
  title: "Rec One",
};
const R2: TrackDTO = {
  ...T1,
  id: "33333333-3333-3333-3333-333333333333",
  title: "Rec Two",
};

function makeHarness(over: Partial<RecommendationRoutesDeps> = {}) {
  const jwtSecret = "test-jwt-secret-with-32-chars-min!!";
  const token = signJwt("user-1", jwtSecret, 60_000);
  const calls: { fn: string; args: unknown[] }[] = [];
  const deps: RecommendationRoutesDeps = {
    jwtSecret,
    getHomeFeed: async (userId, limit) => {
      calls.push({ fn: "getHomeFeed", args: [userId, limit] });
      return [R1, R2];
    },
    startRadio: async (userId, seedTrackId) => {
      calls.push({ fn: "startRadio", args: [userId, seedTrackId] });
      return {
        current: { id: "item-1", track: T1 },
        upcoming: [{ id: "item-2", track: R1 }],
        history: [],
        version: 1,
      };
    },
    extendRadio: async (userId) => {
      calls.push({ fn: "extendRadio", args: [userId] });
      return {
        current: { id: "item-1", track: T1 },
        upcoming: [
          { id: "item-2", track: R1 },
          { id: "item-3", track: R2 },
        ],
        history: [],
        version: 2,
      };
    },
    ...over,
  };
  const app = buildApp(
    {
      CORS_ORIGIN: undefined,
      RESOLVER_URL: "http://unused",
      LAVALINK_URL: "http://unused",
      LAVALINK_PASSWORD: "x",
      JWT_SECRET: jwtSecret,
      REFRESH_SECRET: "test-refresh-secret-32-chars-min!!",
    },
    { recommendation: deps },
  );
  const authed = { authorization: `Bearer ${token}` };
  return { app, authed, calls };
}

describe("GET /api/v1/recommendations", () => {
  it("401 เมื่อไม่มี Bearer", async () => {
    const { app } = makeHarness();
    const res = await app.inject({ method: "GET", url: "/api/v1/recommendations" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("200 { tracks } + default limit 20", async () => {
    const { app, authed, calls } = makeHarness();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/recommendations",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tracks: [R1, R2] });
    expect(calls[0]).toMatchObject({ fn: "getHomeFeed", args: ["user-1", 20] });
    await app.close();
  });

  it("?limit ปรับได้ + clamp ที่ 50", async () => {
    const { app, authed, calls } = makeHarness();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/recommendations?limit=999",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tracks).toHaveLength(2);
    expect(calls[0]!.args[1]).toBe(50);
    await app.close();
  });

  it("ไม่มี provider → 200 { tracks: [] } (fail-soft ไม่ 5xx)", async () => {
    const { app, authed, calls } = makeHarness({ getHomeFeed: undefined });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/recommendations",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tracks: [] });
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("getHomeFeed throw → 200 { tracks: [] } (§9 fail-soft)", async () => {
    const { app, authed } = makeHarness({
      getHomeFeed: async () => {
        throw new Error("boom");
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/recommendations",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tracks: [] });
    await app.close();
  });
});

describe("POST /api/v1/radio/start", () => {
  it("200 QueueStateDTO (current = seed)", async () => {
    const { app, authed, calls } = makeHarness();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/radio/start",
      headers: authed,
      payload: { seedTrackId: T1.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.current.track.id).toBe(T1.id);
    expect(body.upcoming).toHaveLength(1);
    expect(calls[0]).toMatchObject({ fn: "startRadio", args: ["user-1", T1.id] });
    await app.close();
  });

  it("400 เมื่อ body ผิด / seed ไม่ใช่ uuid", async () => {
    const { app, authed } = makeHarness();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/radio/start",
      headers: authed,
      payload: { seedTrackId: "nope" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("404 TRACK_NOT_FOUND เมื่อ seed ไม่พบ (PlayerError mapping)", async () => {
    const { app, authed } = makeHarness({
      startRadio: async () => {
        throw new PlayerError("Track not found", "TRACK_NOT_FOUND");
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/radio/start",
      headers: authed,
      payload: { seedTrackId: T1.id },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TRACK_NOT_FOUND");
    await app.close();
  });
});

describe("POST /api/v1/radio/extend", () => {
  it("200 QueueStateDTO (upcoming ถูกเติม)", async () => {
    const { app, authed, calls } = makeHarness();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/radio/extend",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().upcoming).toHaveLength(2);
    expect(calls[0]).toMatchObject({ fn: "extendRadio", args: ["user-1"] });
    await app.close();
  });

  it("409 NO_RADIO เมื่อไม่มี radio", async () => {
    const { app, authed } = makeHarness({
      extendRadio: async () => {
        throw new PlayerError("No radio is active", "NO_RADIO");
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/radio/extend",
      headers: authed,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NO_RADIO");
    await app.close();
  });
});
