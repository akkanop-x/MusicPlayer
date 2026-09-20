import { describe, expect, it } from "vitest";
import { signJwt } from "../services/auth/jwt.js";
import { buildApp } from "../app.js";
import { createPlayerService, type PlayerDeps } from "../services/PlayerService.js";
import type { TrackDTO } from "@musicplayer/shared";

const T1: TrackDTO = {
  id: "11111111-1111-1111-1111-111111111111",
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

const LIVE: TrackDTO = {
  ...T1,
  id: "22222222-2222-2222-2222-222222222222",
  title: "Live",
  isStream: true,
  isSeekable: false,
};

function makeDeps(): PlayerDeps & { tracks: Map<string, TrackDTO> } {
  const tracks = new Map<string, TrackDTO>([
    [T1.id, T1],
    [LIVE.id, LIVE],
  ]);
  const settingsStore = new Map<
    string,
    { volume?: number; repeatMode?: TrackDTO["isLiked"] extends never ? never : string }
  >();
  return {
    tracks,
    findTrack: async (id) => tracks.get(id) ?? null,
    getSettings: async () => ({
      volume: 80,
      muted: false,
      repeatMode: "off" as const,
      shuffle: false,
      autoplay: true,
    }),
    saveSettings: async (userId, patch) => {
      settingsStore.set(userId, { ...settingsStore.get(userId), ...patch });
    },
  };
}

function makeHarness() {
  const deps = makeDeps();
  const player = createPlayerService(deps);
  const jwtSecret = "test-jwt-secret-with-32-chars-min!!";
  const token = signJwt("user-1", jwtSecret, 60_000);
  const app = buildApp(
    {
      CORS_ORIGIN: undefined,
      RESOLVER_URL: "http://unused",
      LAVALINK_URL: "http://unused",
      LAVALINK_PASSWORD: "x",
      JWT_SECRET: jwtSecret,
      REFRESH_SECRET: "test-refresh-secret-32-chars-min!!",
    },
    { player: { jwtSecret, player } },
  );
  const authed = { authorization: `Bearer ${token}` };
  return { app, authed, deps };
}

const PLAY = {
  method: "POST" as const,
  url: "/api/v1/player/play",
  payload: { trackId: T1.id },
};

describe("GET /api/v1/player", () => {
  it("401 เมื่อไม่มี Bearer", async () => {
    const { app } = makeHarness();
    const res = await app.inject({ method: "GET", url: "/api/v1/player" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("IDLE ตั้งแต่ยังไม่เล่นอะไร + default settings", async () => {
    const { app, authed } = makeHarness();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/player",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      state: "IDLE",
      track: null,
      positionMs: 0,
      volume: 80,
      muted: false,
      repeatMode: "off",
      shuffle: false,
      autoplay: true,
    });
    await app.close();
  });
});

describe("POST /player/play", () => {
  it("play → PLAYING ทันที (optimistic) + track DTO", async () => {
    const { app, authed } = makeHarness();
    const res = await app.inject({ ...PLAY, headers: authed });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state).toBe("PLAYING");
    expect(body.track.id).toBe(T1.id);
    expect(body.positionMs).toBe(0);
    // stream_url ห้ามหลุดออกไป
    expect(res.body).not.toContain("streamUrl");
    await app.close();
  });

  it("track ไม่พบ → 404 TRACK_NOT_FOUND", async () => {
    const { app, authed } = makeHarness();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/player/play",
      headers: authed,
      payload: { trackId: "99999999-9999-9999-9999-999999999999" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TRACK_NOT_FOUND");
    await app.close();
  });

  it("body ไม่ผ่าน validation → 400", async () => {
    const { app, authed } = makeHarness();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/player/play",
      headers: authed,
      payload: { trackId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});

describe("pause/resume/seek", () => {
  it("pause ตอนยังไม่เล่น → 409 NOT_PLAYING; play → pause → PAUSED; resume → PLAYING", async () => {
    const { app, authed } = makeHarness();
    const notPlaying = await app.inject({
      method: "POST",
      url: "/api/v1/player/pause",
      headers: authed,
    });
    expect(notPlaying.statusCode).toBe(409);
    expect(notPlaying.json().error.code).toBe("NOT_PLAYING");

    await app.inject({ ...PLAY, headers: authed });
    const paused = await app.inject({
      method: "POST",
      url: "/api/v1/player/pause",
      headers: authed,
    });
    expect(paused.json().state).toBe("PAUSED");

    const notPaused = await app.inject({
      method: "POST",
      url: "/api/v1/player/pause",
      headers: authed,
    });
    expect(notPaused.json().error.code).toBe("NOT_PLAYING");

    const resumed = await app.inject({
      method: "POST",
      url: "/api/v1/player/resume",
      headers: authed,
    });
    expect(resumed.json().state).toBe("PLAYING");
    await app.close();
  });

  it("resume ตอนไม่ได้ pause → 409 NOT_PAUSED", async () => {
    const { app, authed } = makeHarness();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/player/resume",
      headers: authed,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NOT_PAUSED");
    await app.close();
  });

  it("seek กลางเพลง → BUFFERING + position ใหม่; เกิน duration → 400; บน stream → 400", async () => {
    const { app, authed } = makeHarness();
    await app.inject({ ...PLAY, headers: authed });
    const seek = await app.inject({
      method: "POST",
      url: "/api/v1/player/seek",
      headers: authed,
      payload: { positionMs: 60_000 },
    });
    expect(seek.json().state).toBe("BUFFERING");
    expect(seek.json().positionMs).toBe(60_000);

    const beyond = await app.inject({
      method: "POST",
      url: "/api/v1/player/seek",
      headers: authed,
      payload: { positionMs: 500_000 },
    });
    expect(beyond.statusCode).toBe(400);

    await app.inject({
      method: "POST",
      url: "/api/v1/player/play",
      headers: authed,
      payload: { trackId: LIVE.id },
    });
    const onStream = await app.inject({
      method: "POST",
      url: "/api/v1/player/seek",
      headers: authed,
      payload: { positionMs: 1_000 },
    });
    expect(onStream.statusCode).toBe(400);
    await app.close();
  });
});

describe("skip/previous (queue จำลอง 1 เพลง)", () => {
  it("skip โดยไม่มี repeat → 409 NO_NEXT + QueueStateDTO shape", async () => {
    const { app, authed } = makeHarness();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/player/skip",
      headers: authed,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NO_NEXT");
    await app.close();
  });

  it("repeat=one → skip วนเพลงเดิม + ได้ QueueStateDTO (upcoming ว่าง)", async () => {
    const { app, authed } = makeHarness();
    await app.inject({ ...PLAY, headers: authed });
    await app.inject({
      method: "PATCH",
      url: "/api/v1/player/repeat",
      headers: authed,
      payload: { mode: "one" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/player/skip",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      current: T1,
      upcoming: [],
      history: [],
      version: expect.any(Number),
    });
    await app.close();
  });

  it("previous ตอนยังไม่เล่น → 409 NOT_PLAYING; เล่นแล้วไม่มี history → 409 NO_PREVIOUS", async () => {
    const { app, authed } = makeHarness();
    const idle = await app.inject({
      method: "POST",
      url: "/api/v1/player/previous",
      headers: authed,
    });
    expect(idle.statusCode).toBe(409);
    expect(idle.json().error.code).toBe("NOT_PLAYING");

    await app.inject({ ...PLAY, headers: authed });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/player/previous",
      headers: authed,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NO_PREVIOUS");
    await app.close();
  });

  it("play เพลงใหม่ → เพลงเดิมเข้า history; previous กลับไปเพลงเดิมได้", async () => {
    const { app, authed, deps } = makeHarness();
    const T2: TrackDTO = {
      ...T1,
      id: "33333333-3333-3333-3333-333333333333",
      title: "Song Two",
    };
    deps.tracks.set(T2.id, T2);
    await app.inject({ ...PLAY, headers: authed });
    await app.inject({
      method: "POST",
      url: "/api/v1/player/play",
      headers: authed,
      payload: { trackId: T2.id },
    });
    const prev = await app.inject({
      method: "POST",
      url: "/api/v1/player/previous",
      headers: authed,
    });
    expect(prev.json().track.id).toBe(T1.id);
    await app.close();
  });
});

describe("volume/repeat", () => {
  it("volume 30 → DTO อัปเดต; เกิน 100 → 400", async () => {
    const { app, authed } = makeHarness();
    const ok = await app.inject({
      method: "PATCH",
      url: "/api/v1/player/volume",
      headers: authed,
      payload: { volume: 30 },
    });
    expect(ok.json().volume).toBe(30);
    expect(ok.json().muted).toBe(false);

    const zero = await app.inject({
      method: "PATCH",
      url: "/api/v1/player/volume",
      headers: authed,
      payload: { volume: 0 },
    });
    expect(zero.json().muted).toBe(true);

    const bad = await app.inject({
      method: "PATCH",
      url: "/api/v1/player/volume",
      headers: authed,
      payload: { volume: 101 },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it("repeat mode ตั้งได้ 3 แบบ; อื่น ๆ → 400", async () => {
    const { app, authed } = makeHarness();
    for (const mode of ["one", "all", "off"] as const) {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/player/repeat",
        headers: authed,
        payload: { mode },
      });
      expect(res.json().repeatMode).toBe(mode);
    }
    const bad = await app.inject({
      method: "PATCH",
      url: "/api/v1/player/repeat",
      headers: authed,
      payload: { mode: "sometimes" },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});
