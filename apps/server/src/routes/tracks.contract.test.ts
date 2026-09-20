import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { signJwt } from "../services/auth/jwt.js";
import type { TrackDTO } from "@musicplayer/shared";

const JWT_SECRET = "test-jwt-secret-with-32-chars-min!!";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

const T1: TrackDTO = {
  id: ID1,
  title: "Song One",
  artist: "Artist",
  album: null,
  durationMs: 213_000,
  isStream: false,
  isSeekable: true,
  artworkUrl: null,
  sourceName: "youtube",
  isLiked: false,
};

const AUTH = { authorization: `Bearer ${signJwt(USER_ID, JWT_SECRET, 60_000)}` };

function makeHarness(store: TrackDTO[]) {
  const findTrackById = vi.fn(
    async (id: string) => store.find((t) => t.id === id) ?? null,
  );
  const findTracksByIds = vi.fn(async (ids: string[]) =>
    ids.flatMap((id) => {
      const t = store.find((x) => x.id === id);
      return t ? [t] : [];
    }),
  );
  const app = buildApp(
    {
      CORS_ORIGIN: undefined,
      RESOLVER_URL: "http://unused",
      LAVALINK_URL: "http://unused",
      LAVALINK_PASSWORD: "x",
      JWT_SECRET,
      REFRESH_SECRET: "test-refresh-secret-32-chars-min!!",
    },
    { tracks: { findTrackById, findTracksByIds } },
  );
  return { app, findTrackById, findTracksByIds };
}

describe("GET /api/v1/tracks — api.md §3 endpoint 7–8", () => {
  it("ไม่มี Bearer → 401", async () => {
    const { app } = makeHarness([T1]);
    const res = await app.inject({ method: "GET", url: `/api/v1/tracks/${ID1}` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /tracks/:id → 200 TrackDTO", async () => {
    const { app, findTrackById } = makeHarness([T1]);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tracks/${ID1}`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(T1);
    expect(findTrackById).toHaveBeenCalledWith(ID1);
    await app.close();
  });

  it("GET /tracks/:id ไม่พบ → 404 TRACK_NOT_FOUND", async () => {
    const { app } = makeHarness([]);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tracks/${ID1}`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TRACK_NOT_FOUND");
    await app.close();
  });

  it("GET /tracks/:id id ไม่ใช่ uuid → 400", async () => {
    const { app } = makeHarness([T1]);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tracks/not-a-uuid",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("GET /tracks?ids= → 200 { tracks } คงลำดับ ids + dedupe ids ซ้ำ", async () => {
    const t2 = { ...T1, id: ID2, title: "Song Two" };
    const { app, findTracksByIds } = makeHarness([T1, t2]);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tracks?ids=${ID2},${ID1},${ID2}`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tracks.map((t: TrackDTO) => t.id)).toEqual([ID2, ID1]);
    // dedupe แล้วเหลือ 2 — ไม่ยิง id ซ้ำเข้า repo
    expect(findTracksByIds).toHaveBeenCalledWith([ID2, ID1]);
    await app.close();
  });

  it("GET /tracks?ids= ว่าง / เกิน 50 / uuid ผิด → 400", async () => {
    const { app } = makeHarness([T1]);
    for (const url of [
      "/api/v1/tracks?ids=",
      `/api/v1/tracks?ids=${Array.from({ length: 51 }, () => ID1).join(",")}`,
      "/api/v1/tracks?ids=bogus",
    ]) {
      const res = await app.inject({ method: "GET", url, headers: AUTH });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });
});
