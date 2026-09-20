/**
 * WS contract tests — websocket.md (hermetic: socket.io-client จริง, port 0, repos mock ทั้งหมด)
 * ครอบ: auth handshake / room isolation / event จาก REST mutations / version monotonic /
 * POSITION_SYNC validation / TRACK_ENDED advance+QUEUE_ENDED / TRACK_STALLED threshold / SYNC_REQUEST
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { signJwt } from "../services/auth/jwt.js";
import { buildApp, type AppDeps } from "../app.js";
import type { QueueSnapshot } from "../services/PlayerService.js";
import { RealtimeClientEvents, RealtimeEvents } from "@musicplayer/shared";

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";

function trackDto(id: string, title: string) {
  return {
    id,
    title,
    artist: "Artist",
    album: null,
    durationMs: 213_000,
    isStream: false,
    isSeekable: true,
    artworkUrl: null,
    sourceName: "youtube",
    isLiked: false,
  };
}

function makeRepos(): AppDeps["playerRepos"] {
  const tracks = new Map<string, ReturnType<typeof trackDto>>([
    [T1, trackDto(T1, "Song One")],
    [T2, trackDto(T2, "Song Two")],
  ]);
  const snapshots = new Map<string, QueueSnapshot>();
  return {
    findTrack: async (id: string) => tracks.get(id) ?? null,
    getSettings: async () => ({
      volume: 80,
      muted: false,
      repeatMode: "off" as const,
      shuffle: false,
      autoplay: true,
    }),
    saveSettings: async () => undefined,
    loadQueue: async (userId: string) => snapshots.get(userId) ?? null,
    saveQueue: async (userId: string, snapshot: QueueSnapshot) => {
      snapshots.set(userId, JSON.parse(JSON.stringify(snapshot)) as QueueSnapshot);
    },
  };
}

const JWT_SECRET = "test-jwt-secret-with-32-chars-min!!";
const ENV = {
  CORS_ORIGIN: undefined,
  LAVALINK_URL: "http://unused",
  LAVALINK_PASSWORD: "x",
  RESOLVER_URL: "http://unused",
  JWT_SECRET,
  REFRESH_SECRET: "refresh-secret",
} as const;

function makeHarness() {
  const repos = makeRepos();
  const app = buildApp(ENV, { playerRepos: repos });
  return { app };
}

async function listen(app: ReturnType<typeof buildApp>): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function connect(url: string, token: string | null): Socket {
  return ioClient(url, {
    path: "/ws",
    transports: ["websocket"],
    auth: token ? { token } : {},
    reconnection: false,
    timeout: 2_000,
  });
}

/** รอ event แรกที่ตรงเงื่อนไข (filter ได้) — timeout ตาม vitest test */
function nextEvent<T = Record<string, unknown>>(
  socket: Socket,
  event: string,
  filter?: (payload: T) => boolean,
): Promise<T> {
  return new Promise((resolve) => {
    const handler = (payload: T) => {
      if (filter && !filter(payload)) return;
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

describe("WS — auth handshake (websocket.md §1)", () => {
  it("ไม่ส่ง token → connect_error UNAUTHENTICATED", async () => {
    const { app } = makeHarness();
    const url = await listen(app);
    const socket = connect(url, null);
    const error = await new Promise<Error>((resolve) => {
      socket.on("connect_error", (e: Error) => resolve(e));
    });
    expect(error.message).toBe("UNAUTHENTICATED");
    socket.close();
    await app.close();
  });

  it("token พัง → connect_error", async () => {
    const { app } = makeHarness();
    const url = await listen(app);
    const socket = connect(url, "not-a-jwt");
    const error = await new Promise<Error>((resolve) => {
      socket.on("connect_error", (e: Error) => resolve(e));
    });
    expect(error.message).toBe("UNAUTHENTICATED");
    socket.close();
    await app.close();
  });

  it("token ถูกต้อง → connected + SYNC_REQUEST ได้ state ล่าสุดครบสอง event", async () => {
    const { app } = makeHarness();
    const url = await listen(app);
    const token = signJwt("user-1", JWT_SECRET, 60_000);
    const socket = connect(url, token);
    await new Promise((r) => socket.on("connect", () => r(undefined)));

    const playerP = nextEvent<{ state: string; track: null; version: number }>(
      socket,
      RealtimeEvents.PlayerStateChanged,
    );
    const queueP = nextEvent<{
      queue: { upcoming: unknown[] };
    }>(socket, RealtimeEvents.QueueUpdated);
    socket.emit(RealtimeClientEvents.SyncRequest, {});
    const [player, queue] = await Promise.all([playerP, queueP]);
    expect(player.state).toBe("IDLE");
    expect(player.track).toBeNull();
    expect(player.version).toBeGreaterThan(0);
    expect(queue.queue.upcoming).toEqual([]);

    socket.close();
    await app.close();
  });
});

describe("WS — room ต่อ user + event จาก REST mutation (websocket.md §3/§7)", () => {
  let app: ReturnType<typeof buildApp>;
  let url: string;
  let tokenA: string;
  let tokenB: string; // user เดียวกับ A (อีก tab)
  let tokenC: string; // คนละ user

  beforeEach(async () => {
    app = makeHarness().app;
    url = await listen(app);
    tokenA = signJwt("user-1", JWT_SECRET, 60_000);
    tokenB = signJwt("user-1", JWT_SECRET, 60_000);
    tokenC = signJwt("user-2", JWT_SECRET, 60_000);
  });
  afterEach(async () => {
    await app.close();
  });

  it("play ผ่าน REST → ทุก connection ของ user เดียวกันได้ event ครบ, user อื่นไม่ได้", async () => {
    const tabA = connect(url, tokenA);
    const tabB = connect(url, tokenB);
    const other = connect(url, tokenC);
    await Promise.all([
      new Promise((r) => tabA.on("connect", () => r(undefined))),
      new Promise((r) => tabB.on("connect", () => r(undefined))),
      new Promise((r) => other.on("connect", () => r(undefined))),
    ]);

    const startedA = nextEvent<{ item: { track: { id: string } }; positionMs: number }>(
      tabA,
      RealtimeEvents.TrackStarted,
    );
    const startedB = nextEvent<{ item: { track: { title: string } } }>(
      tabB,
      RealtimeEvents.TrackStarted,
    );
    const queueB = nextEvent<{
      queue: { current: { track: { id: string } } };
    }>(tabB, RealtimeEvents.QueueUpdated);
    // user-2 ไม่ควรได้ยินอะไร — ถ้าได้รับ event ให้ fail ผ่าน flag
    let otherHeard = false;
    other.onAny(() => {
      otherHeard = true;
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/player/play",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { trackId: T1 },
    });
    expect(res.statusCode).toBe(200);

    const [a, b, q] = await Promise.all([startedA, startedB, queueB]);
    expect(a.item.track.id).toBe(T1);
    expect(a.positionMs).toBe(0);
    expect(b.item.track.title).toBe("Song One");
    expect(q.queue.current.track.id).toBe(T1);
    // ให้เวลาเหตุการณ์เล็ดลัด (ถ้ามี) — user อื่นต้องยังเงียบ
    await new Promise((r) => setTimeout(r, 100));
    expect(otherHeard).toBe(false);

    tabA.close();
    tabB.close();
    other.close();
  });

  it("version เดิน monotonic บน event ของ user เดียวกัน", async () => {
    const tabB = connect(url, tokenB);
    await new Promise((r) => tabB.on("connect", () => r(undefined)));
    const events: Array<{ version: number }> = [];
    const collect = (event: string) =>
      nextEvent<{ version: number }>(tabB, event).then((p) => events.push(p));
    const wait = Promise.all([
      collect(RealtimeEvents.TrackStarted),
      collect(RealtimeEvents.QueueUpdated),
    ]);

    await app.inject({
      method: "POST",
      url: "/api/v1/player/play",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { trackId: T1 },
    });
    await wait;
    expect(events.length).toBe(2);
    expect(events[1]!.version).toBeGreaterThan(events[0]!.version);

    tabB.close();
  });

  it("PATCH volume → VOLUME_CHANGED ไปทุก tab", async () => {
    const tabA = connect(url, tokenA);
    const tabB = connect(url, tokenB);
    await Promise.all([
      new Promise((r) => tabA.on("connect", () => r(undefined))),
      new Promise((r) => tabB.on("connect", () => r(undefined))),
    ]);
    const volumeB = nextEvent<{ volume: number; muted: boolean }>(
      tabB,
      RealtimeEvents.VolumeChanged,
    );
    await app.inject({
      method: "PATCH",
      url: "/api/v1/player/volume",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { volume: 30 },
    });
    const payload = await volumeB;
    expect(payload.volume).toBe(30);
    expect(payload.muted).toBe(false);

    tabA.close();
    tabB.close();
  });
});

describe("WS — client → server (websocket.md §4)", () => {
  let app: ReturnType<typeof buildApp>;
  let url: string;
  let token: string;

  beforeEach(async () => {
    app = makeHarness().app;
    url = await listen(app);
    token = signJwt("user-1", JWT_SECRET, 60_000);
    // เริ่มเล่น T1 ทุก test ใน describe นี้ (state ต่อ user อยู่ใน service เดียวกัน)
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/player/play",
      headers: { authorization: `Bearer ${token}` },
      payload: { trackId: T1 },
    });
    expect(res.statusCode).toBe(200);
  });
  afterEach(async () => {
    await app.close();
  });

  it("POSITION_SYNC ปกติ → ack ok:true", async () => {
    const socket = connect(url, token);
    await new Promise((r) => socket.on("connect", () => r(undefined)));
    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      socket.emit(
        RealtimeClientEvents.PositionSync,
        { positionMs: 1_000 },
        (res: { ok: boolean }) => resolve(res),
      );
    });
    expect(ack.ok).toBe(true);
    socket.close();
  });

  it("POSITION_SYNC กระโดดเร็วกว่า real-time ×1.2 → ack ok:false + POSITION_UPDATED", async () => {
    const socket = connect(url, token);
    await new Promise((r) => socket.on("connect", () => r(undefined)));
    const ackOf = (positionMs: number) =>
      new Promise<{ ok: boolean }>((resolve) => {
        socket.emit(
          RealtimeClientEvents.PositionSync,
          { positionMs },
          (res: { ok: boolean }) => resolve(res),
        );
      });
    expect((await ackOf(1_000)).ok).toBe(true); // ตั้ง lastSync
    const updated = nextEvent(socket, RealtimeEvents.PositionUpdated);
    expect((await ackOf(120_000)).ok).toBe(false); // 5 วิใน 50 ms — เร็วเกิน
    const payload = await updated;
    expect(payload.positionMs).toBeLessThan(5_000); // server บอกตำแหน่งจริงกลับ

    socket.close();
  });

  it("TRACK_ENDED → advance ไปเพลงถัดไป; หมดคิว → QUEUE_ENDED", async () => {
    // เพิ่ม T2 เข้าคิวหลังจาก play T1
    const add = await app.inject({
      method: "POST",
      url: "/api/v1/queue/tracks",
      headers: { authorization: `Bearer ${token}` },
      payload: { trackIds: [T2] },
    });
    expect(add.statusCode).toBe(200);

    const socket = connect(url, token);
    await new Promise((r) => socket.on("connect", () => r(undefined)));
    const started = nextEvent<{ item: { track: { id: string } } }>(
      socket,
      RealtimeEvents.TrackStarted,
    );
    const ack = await new Promise<{ ok: boolean; ended: boolean }>((resolve) => {
      socket.emit(
        RealtimeClientEvents.TrackEndedReport,
        { trackId: T1, msPlayed: 213_000 },
        (res: { ok: boolean; ended: boolean }) => resolve(res),
      );
    });
    expect(ack).toEqual({ ok: true, ended: true });
    const payload = await started;
    expect(payload.item.track.id).toBe(T2);

    // เพลงสุดท้ายจบ (upcoming ว่าง, repeat off) → QUEUE_ENDED
    const endedP = nextEvent(socket, RealtimeEvents.QueueEnded);
    const stateP = nextEvent<{ state: string }>(
      socket,
      RealtimeEvents.PlayerStateChanged,
      (p) => p.state === "IDLE",
    );
    const ack2 = await new Promise<{ ok: boolean }>((resolve) => {
      socket.emit(
        RealtimeClientEvents.TrackEndedReport,
        { trackId: T2, msPlayed: 213_000 },
        (res: { ok: boolean }) => resolve(res),
      );
    });
    expect(ack2.ok).toBe(true);
    await endedP;
    expect((await stateP).state).toBe("IDLE");

    socket.close();
  });

  it("TRACK_ENDED ของ track ที่ไม่ใช่ current → ended:false (ไม่ advance)", async () => {
    const socket = connect(url, token);
    await new Promise((r) => socket.on("connect", () => r(undefined)));
    const ack = await new Promise<{ ok: boolean; ended: boolean }>((resolve) => {
      socket.emit(
        RealtimeClientEvents.TrackEndedReport,
        { trackId: T2 },
        (res: { ok: boolean; ended: boolean }) => resolve(res),
      );
    });
    expect(ack).toEqual({ ok: true, ended: false });
    socket.close();
  });

  it("TRACK_STALLED ครบ 3 ครั้งใน 30 s → TRACK_EXCEPTION + advance", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/queue/tracks",
      headers: { authorization: `Bearer ${token}` },
      payload: { trackIds: [T2] },
    });
    const socket = connect(url, token);
    await new Promise((r) => socket.on("connect", () => r(undefined)));

    const ackOf = () =>
      new Promise<{ ok: boolean; exception: boolean }>((resolve) => {
        socket.emit(
          RealtimeClientEvents.TrackStalled,
          { trackId: T1, positionMs: 500, attempt: 1 },
          (res: { ok: boolean; exception: boolean }) => resolve(res),
        );
      });
    expect((await ackOf()).exception).toBe(false);
    expect((await ackOf()).exception).toBe(false);

    const exceptionP = nextEvent<{ code: string; item: { track: { id: string } } }>(
      socket,
      RealtimeEvents.TrackException,
    );
    const startedP = nextEvent<{ item: { track: { id: string } } }>(
      socket,
      RealtimeEvents.TrackStarted,
    );
    expect((await ackOf()).exception).toBe(true);
    const exception = await exceptionP;
    expect(exception.code).toBe("SOURCE_ERROR");
    expect(exception.item.track.id).toBe(T1);
    expect((await startedP).item.track.id).toBe(T2);

    socket.close();
  });
});
