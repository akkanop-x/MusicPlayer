import { describe, expect, it } from "vitest";
import { signJwt } from "../services/auth/jwt.js";
import { buildApp } from "../app.js";
import { createPlayerService } from "../services/PlayerService.js";
import type { RepeatMode, TrackDTO } from "@musicplayer/shared";

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
const T2: TrackDTO = {
  ...T1,
  id: "22222222-2222-2222-2222-222222222222",
  title: "Song Two",
};
const T3: TrackDTO = {
  ...T1,
  id: "33333333-3333-3333-3333-333333333333",
  title: "Song Three",
};

/** harness ที่ "persist จริง" ลง fake store — ใช้ทดสอบ restart-restore ได้ */
function makeHarness() {
  const tracks = new Map([
    [T1.id, T1],
    [T2.id, T2],
    [T3.id, T3],
  ]);
  const settingsStore = new Map<string, Record<string, unknown>>();
  const snapshots = new Map<
    string,
    {
      currentTrackId: string | null;
      positionMs: number;
      shuffleOn: boolean;
      repeatMode: RepeatMode;
      upcoming: Array<{ id: string; trackId: string; originalPosition: number }>;
      history: Array<{ id: string; trackId: string; originalPosition: number }>;
    }
  >();
  const playerDeps = {
    findTrack: async (id: string) => tracks.get(id) ?? null,
    getSettings: async (userId: string) => ({
      volume: (settingsStore.get(userId)?.volume as number | undefined) ?? 80,
      muted: false,
      repeatMode: "off" as const,
      shuffle: false,
      autoplay: true,
    }),
    saveSettings: async (userId: string, patch: Record<string, unknown>) => {
      settingsStore.set(userId, { ...settingsStore.get(userId), ...patch });
    },
    loadQueue: async (userId: string) => snapshots.get(userId) ?? null,
    saveQueue: async (
      userId: string,
      snapshot: {
        currentTrackId: string | null;
        positionMs: number;
        shuffleOn: boolean;
        repeatMode: RepeatMode;
        upcoming: Array<{ id: string; trackId: string; originalPosition: number }>;
        history: Array<{ id: string; trackId: string; originalPosition: number }>;
      },
    ) => {
      snapshots.set(userId, JSON.parse(JSON.stringify(snapshot)) as typeof snapshot);
    },
  };
  const jwtSecret = "test-jwt-secret-with-32-chars-min!!";
  const token = signJwt("user-1", jwtSecret, 60_000);
  const authed = { authorization: `Bearer ${token}` };

  /** สร้าง app ใหม่ (เหมือน restart backend) — service ใหม่ แต่ snapshot store เดิม */
  const build = () =>
    buildApp(
      {
        CORS_ORIGIN: undefined,
        RESOLVER_URL: "http://unused",
        LAVALINK_URL: "http://unused",
        LAVALINK_PASSWORD: "x",
        JWT_SECRET: jwtSecret,
        REFRESH_SECRET: "test-refresh-secret-32-chars-min!!",
      },
      { player: { jwtSecret, player: createPlayerService(playerDeps) } },
    );

  const app = build();
  return { app, build, authed, snapshots };
}

const post = (url: string, payload?: Record<string, unknown>) => ({
  method: "POST" as const,
  url,
  payload,
});
const patch = (url: string, payload?: Record<string, unknown>) => ({
  method: "PATCH" as const,
  url,
  payload,
});

describe("GET /queue", () => {
  it("401 เมื่อไม่มี Bearer", async () => {
    const { app } = makeHarness();
    const res = await app.inject({ method: "GET", url: "/api/v1/queue" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("queue เปล่าตอนเริ่มต้น", async () => {
    const { app, authed } = makeHarness();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/queue",
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      current: null,
      upcoming: [],
      history: [],
      version: 0,
    });
    await app.close();
  });
});

describe("POST /queue/tracks + /queue/tracks/next", () => {
  it("add ต่อท้าย — ได้ item id ต่อชิ้น (track ซ้ำก็ได้)", async () => {
    const { app, authed } = makeHarness();
    const res = await app.inject({
      ...post("/api/v1/queue/tracks", { trackIds: [T1.id, T2.id, T1.id] }),
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.upcoming.map((i: { track: { id: string } }) => i.track.id)).toEqual([
      T1.id,
      T2.id,
      T1.id,
    ]);
    expect(new Set(body.upcoming.map((i: { id: string }) => i.id)).size).toBe(3);
    await app.close();
  });

  it("addNext แทรกหน้าสุด — หลาย id คงลำดับเดิม", async () => {
    const { app, authed } = makeHarness();
    await app.inject({
      ...post("/api/v1/queue/tracks", { trackIds: [T1.id] }),
      headers: authed,
    });
    const res = await app.inject({
      ...post("/api/v1/queue/tracks/next", { trackIds: [T2.id, T3.id] }),
      headers: authed,
    });
    expect(
      res.json().upcoming.map((i: { track: { id: string } }) => i.track.id),
    ).toEqual([T2.id, T3.id, T1.id]);
    await app.close();
  });

  it("track ไม่พบ → 404; trackIds ว่าง → 400", async () => {
    const { app, authed } = makeHarness();
    const missing = await app.inject({
      ...post("/api/v1/queue/tracks", {
        trackIds: ["99999999-9999-9999-9999-999999999999"],
      }),
      headers: authed,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("TRACK_NOT_FOUND");

    const empty = await app.inject({
      ...post("/api/v1/queue/tracks", { trackIds: [] }),
      headers: authed,
    });
    expect(empty.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /queue/tracks { radioSeedTrackId } (Phase 12)", () => {
  it("เริ่ม radio: current = seed + radio: true ใน GET /player", async () => {
    const { app, authed } = makeHarness();
    const res = await app.inject({
      ...post("/api/v1/queue/tracks", { radioSeedTrackId: T2.id }),
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    const queue = res.json();
    expect(queue.current.track.id).toBe(T2.id);
    // harness นี้ไม่มี provider → upcoming ว่าง แต่ radio ยัง active
    expect(queue.upcoming).toEqual([]);
    const state = await app.inject({
      method: "GET",
      url: "/api/v1/player",
      headers: authed,
    });
    expect(state.json().radio).toBe(true);
    await app.close();
  });

  it("body ไม่ตรง shape ใด → 400 พร้อมข้อความครอบ radioSeedTrackId", async () => {
    const { app, authed } = makeHarness();
    const res = await app.inject({
      ...post("/api/v1/queue/tracks", {}),
      headers: authed,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("radioSeedTrackId");
    await app.close();
  });
});

describe("PATCH /queue/items/:id/move + DELETE /queue/items/:id", () => {
  async function seedQueue(
    app: ReturnType<typeof buildApp>,
    authed: { authorization: string },
  ) {
    const res = await app.inject({
      ...post("/api/v1/queue/tracks", { trackIds: [T1.id, T2.id, T3.id] }),
      headers: authed,
    });
    return res.json().upcoming as Array<{ id: string; track: { id: string } }>;
  }

  it("move ย้าย item ไปตำแหน่งใหม่", async () => {
    const { app, authed } = makeHarness();
    const items = await seedQueue(app, authed);
    const res = await app.inject({
      ...patch(`/api/v1/queue/items/${items[2]!.id}/move`, { toPosition: 0 }),
      headers: authed,
    });
    expect(res.statusCode).toBe(200);
    expect(
      res.json().upcoming.map((i: { track: { id: string } }) => i.track.id),
    ).toEqual([T3.id, T1.id, T2.id]);
    await app.close();
  });

  it("move id ไม่รู้จัก → 404; toPosition ติดลบ → 400", async () => {
    const { app, authed } = makeHarness();
    await seedQueue(app, authed);
    const missing = await app.inject({
      ...patch(`/api/v1/queue/items/aaaaaaaa-aaaa-4aaa-8aaa-000000000001/move`, {
        toPosition: 0,
      }),
      headers: authed,
    });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({
      ...patch(`/api/v1/queue/items/${(await seedQueue(app, authed))[0]!.id}/move`, {
        toPosition: -1,
      }),
      headers: authed,
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it("remove จาก upcoming ได้; remove current → 409 ITEM_IS_CURRENT; id ไม่รู้จัก → 404", async () => {
    const { app, authed } = makeHarness();
    // play ก่อน (play now = แทนที่ upcoming) แล้วค่อย seed queue
    await app.inject({
      ...post("/api/v1/player/play", { trackId: T1.id }),
      headers: authed,
    });
    const items = (
      await app.inject({
        ...post("/api/v1/queue/tracks", { trackIds: [T2.id, T3.id] }),
        headers: authed,
      })
    ).json().upcoming as Array<{ id: string; track: { id: string } }>;

    const current = await app.inject({
      method: "GET",
      url: "/api/v1/queue",
      headers: authed,
    });
    const currentId = current.json().current.id;
    const removeCurrent = await app.inject({
      method: "DELETE",
      url: `/api/v1/queue/items/${currentId}`,
      headers: authed,
    });
    expect(removeCurrent.statusCode).toBe(409);
    expect(removeCurrent.json().error.code).toBe("ITEM_IS_CURRENT");

    const ok = await app.inject({
      method: "DELETE",
      url: `/api/v1/queue/items/${items[0]!.id}`,
      headers: authed,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().upcoming).toHaveLength(1);

    const missing = await app.inject({
      method: "DELETE",
      url: `/api/v1/queue/items/${items[0]!.id}`,
      headers: authed,
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});

describe("DELETE /queue", () => {
  it("clear upcoming คง current/history; scope=all ล้างหมด; scope ผิด → 400", async () => {
    const { app, authed } = makeHarness();
    await app.inject({
      ...post("/api/v1/player/play", { trackId: T1.id }),
      headers: authed,
    });
    await app.inject({
      ...post("/api/v1/queue/tracks", { trackIds: [T2.id] }),
      headers: authed,
    });
    await app.inject({ ...post("/api/v1/player/skip"), headers: authed }); // current=T2, history=[T1]

    const clearUpcoming = await app.inject({
      method: "DELETE",
      url: "/api/v1/queue",
      headers: authed,
    });
    expect(clearUpcoming.json().upcoming).toEqual([]);
    expect(clearUpcoming.json().history).toHaveLength(1);

    const clearAll = await app.inject({
      method: "DELETE",
      url: "/api/v1/queue?scope=all",
      headers: authed,
    });
    expect(clearAll.json()).toEqual({
      current: null,
      upcoming: [],
      history: [],
      version: expect.any(Number),
    });
    const player = await app.inject({
      method: "GET",
      url: "/api/v1/player",
      headers: authed,
    });
    expect(player.json().state).toBe("IDLE");

    const badScope = await app.inject({
      method: "DELETE",
      url: "/api/v1/queue?scope=history",
      headers: authed,
    });
    expect(badScope.statusCode).toBe(400);
    await app.close();
  });
});

describe("skip/previous กับ queue จริง + PATCH /player/shuffle", () => {
  it("skip เดินตาม upcoming; หมดแล้ว → 409 NO_NEXT (repeat off)", async () => {
    const { app, authed } = makeHarness();
    await app.inject({
      ...post("/api/v1/player/play", { trackId: T1.id }),
      headers: authed,
    });
    await app.inject({
      ...post("/api/v1/queue/tracks", { trackIds: [T2.id, T3.id] }),
      headers: authed,
    });

    const s1 = await app.inject({ ...post("/api/v1/player/skip"), headers: authed });
    expect(s1.json().current.track.id).toBe(T2.id);
    expect(s1.json().history.map((i: { track: { id: string } }) => i.track.id)).toEqual(
      [T1.id],
    );
    const s2 = await app.inject({ ...post("/api/v1/player/skip"), headers: authed });
    expect(s2.json().current.track.id).toBe(T3.id);
    const s3 = await app.inject({ ...post("/api/v1/player/skip"), headers: authed });
    expect(s3.statusCode).toBe(409);
    expect(s3.json().error.code).toBe("NO_NEXT");
    await app.close();
  });

  it("repeat=all → skip วนรอบใหม่จากต้น", async () => {
    const { app, authed } = makeHarness();
    await app.inject({
      ...post("/api/v1/player/play", { trackId: T1.id }),
      headers: authed,
    });
    await app.inject({
      ...post("/api/v1/queue/tracks", { trackIds: [T2.id] }),
      headers: authed,
    });
    await app.inject({
      ...patch("/api/v1/player/repeat", { mode: "all" }),
      headers: authed,
    });
    expect(
      (await app.inject({ ...post("/api/v1/player/skip"), headers: authed })).json()
        .current.track.id,
    ).toBe(T2.id);
    const wrap = await app.inject({ ...post("/api/v1/player/skip"), headers: authed });
    expect(wrap.json().current.track.id).toBe(T1.id);
    expect(
      wrap.json().upcoming.map((i: { track: { id: string } }) => i.track.id),
    ).toEqual([T2.id]);
    await app.close();
  });

  it("previous ป๊อป history กลับมาเป็น current", async () => {
    const { app, authed } = makeHarness();
    await app.inject({
      ...post("/api/v1/player/play", { trackId: T1.id }),
      headers: authed,
    });
    await app.inject({
      ...post("/api/v1/queue/tracks", { trackIds: [T2.id] }),
      headers: authed,
    });
    await app.inject({ ...post("/api/v1/player/skip"), headers: authed });
    const prev = await app.inject({
      ...post("/api/v1/player/previous"),
      headers: authed,
    });
    expect(prev.json().track.id).toBe(T1.id);
    const queue = await app.inject({
      method: "GET",
      url: "/api/v1/queue",
      headers: authed,
    });
    expect(queue.json().upcoming[0].track.id).toBe(T2.id);
    await app.close();
  });

  it("PATCH /player/shuffle สลับ upcoming; ปิด → คืนลำดับเดิม; enabled ไม่ส่ง → 400", async () => {
    const { app, authed } = makeHarness();
    await app.inject({
      ...post("/api/v1/queue/tracks", { trackIds: [T1.id, T2.id, T3.id] }),
      headers: authed,
    });
    const on = await app.inject({
      ...patch("/api/v1/player/shuffle", { enabled: true }),
      headers: authed,
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().upcoming).toHaveLength(3);
    expect(
      new Set(on.json().upcoming.map((i: { track: { id: string } }) => i.track.id)),
    ).toEqual(new Set([T1.id, T2.id, T3.id]));
    const off = await app.inject({
      ...patch("/api/v1/player/shuffle", { enabled: false }),
      headers: authed,
    });
    expect(
      off.json().upcoming.map((i: { track: { id: string } }) => i.track.id),
    ).toEqual([T1.id, T2.id, T3.id]);
    const bad = await app.inject({
      ...patch("/api/v1/player/shuffle", {}),
      headers: authed,
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});

describe("restart backend → queue กลับมา (restore เป็น PAUSED)", () => {
  it("snapshot ถูก persist ทุก mutation และ restore ครบ current+upcoming+history", async () => {
    const { app, build, authed } = makeHarness();
    await app.inject({
      ...post("/api/v1/player/play", { trackId: T1.id }),
      headers: authed,
    });
    await app.inject({
      ...post("/api/v1/queue/tracks", { trackIds: [T2.id, T3.id] }),
      headers: authed,
    });
    await app.inject({ ...post("/api/v1/player/skip"), headers: authed }); // current=T2, history=[T1], upcoming=[T3]
    await app.inject({
      ...patch("/api/v1/player/volume", { volume: 30 }),
      headers: authed,
    });
    await app.close();

    // "restart" — app ใหม่ (service ใหม่) แต่ snapshot store เดิม
    const app2 = build();
    const queue = await app2.inject({
      method: "GET",
      url: "/api/v1/queue",
      headers: authed,
    });
    expect(queue.json().current.track.id).toBe(T2.id);
    expect(
      queue.json().upcoming.map((i: { track: { id: string } }) => i.track.id),
    ).toEqual([T3.id]);
    expect(
      queue.json().history.map((i: { track: { id: string } }) => i.track.id),
    ).toEqual([T1.id]);

    const player = await app2.inject({
      method: "GET",
      url: "/api/v1/player",
      headers: authed,
    });
    expect(player.json().state).toBe("PAUSED"); // restore ไม่ auto-play (player.md #7)
    expect(player.json().track.id).toBe(T2.id);
    expect(player.json().volume).toBe(30);
    await app2.close();
  });
});
