/**
 * EQ contract tests — api.md §10 #38–44 + equalizer.md §4/§5 (hermetic: inject mock EqService)
 * ครอบ: settings get/patch, presets CRUD + 403 system + 409 ชื่อซ้ำ, PUT active,
 * EQ_CHANGED broadcast ผ่าน WS จริง (socket.io-client, port 0)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { signJwt } from "../services/auth/jwt.js";
import { buildApp, type AppDeps } from "../app.js";
import { type QueueSnapshot } from "../services/PlayerService.js";
import { EqError, type EqService } from "../services/EqService.js";
import {
  RealtimeEvents,
  SYSTEM_EQ_PRESET_IDS,
  type EqPresetDTO,
  type UserSettingsDTO,
} from "@musicplayer/shared";

const JWT_SECRET = "test-jwt-secret-with-32-chars-min!!";
const ENV = {
  CORS_ORIGIN: undefined,
  LAVALINK_URL: "http://unused",
  LAVALINK_PASSWORD: "x",
  RESOLVER_URL: "http://unused",
  JWT_SECRET,
  REFRESH_SECRET: "refresh-secret",
} as const;

const FLAT_ID = SYSTEM_EQ_PRESET_IDS.flat;
const BASS_ID = SYSTEM_EQ_PRESET_IDS.bassBoost;

/** mock EqService — semantics ตรง createEqService แต่ in-memory (ไม่แตะ DB) */
function makeEqService(): EqService {
  interface Stored extends EqPresetDTO {
    owner: string | null;
  }
  const presets = new Map<string, Stored>([
    [
      FLAT_ID,
      {
        id: FLAT_ID,
        name: "Flat",
        bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        isSystem: true,
        owner: null,
      },
    ],
    [
      BASS_ID,
      {
        id: BASS_ID,
        name: "Bass Boost",
        bands: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
        isSystem: true,
        owner: null,
      },
    ],
  ]);
  const active = new Map<string, string | null>();
  const settings = new Map<string, UserSettingsDTO>();
  let nextId = 1;

  const dto = (row: Stored): EqPresetDTO => ({
    id: row.id,
    name: row.name,
    bands: [...row.bands],
    isSystem: row.owner === null,
  });
  const settingsOf = (userId: string): UserSettingsDTO =>
    settings.get(userId) ?? {
      volume: 80,
      muted: false,
      autoplay: true,
      repeatMode: "off",
      shuffle: false,
      activeEqPresetId: null,
      locale: "th",
    };

  return {
    async listPresets(userId) {
      return [...presets.values()]
        .filter((row) => row.owner === null || row.owner === userId)
        .sort((a, b) =>
          a.owner === b.owner
            ? a.name.localeCompare(b.name)
            : a.owner === null
              ? -1
              : 1,
        )
        .map(dto);
    },
    async createPreset(userId, input) {
      const bands = Array.isArray(input.bands) ? (input.bands as number[]) : null;
      if (
        !bands ||
        bands.length !== 10 ||
        bands.some((g) => !Number.isFinite(g) || g < -12 || g > 12)
      ) {
        throw new EqError("VALIDATION_ERROR", "bad bands");
      }
      const name = input.name.trim();
      if (!name || name.length > 100) throw new EqError("VALIDATION_ERROR", "bad name");
      if (
        [...presets.values()].some((row) => row.owner === userId && row.name === name)
      ) {
        throw new EqError("EQ_PRESET_NAME_TAKEN", `preset "${name}" already exists`);
      }
      const row: Stored = {
        id: `custom-${nextId++}`,
        name,
        bands: [...bands],
        isSystem: false,
        owner: userId,
      };
      presets.set(row.id, row);
      return dto(row);
    },
    async updatePreset(userId, id, input) {
      const row = presets.get(id);
      if (!row) throw new EqError("NOT_FOUND", "preset not found");
      if (row.owner !== userId) {
        throw row.owner === null
          ? new EqError("FORBIDDEN", "system preset cannot be modified")
          : new EqError("NOT_FOUND", "preset not found");
      }
      if (input.bands !== undefined) {
        const bands = input.bands as number[];
        if (bands.length !== 10) throw new EqError("VALIDATION_ERROR", "bad bands");
        row.bands = [...bands];
      }
      if (input.name !== undefined) row.name = input.name;
      return { preset: dto(row), wasActive: active.get(userId) === id };
    },
    async deletePreset(userId, id) {
      const row = presets.get(id);
      if (!row) throw new EqError("NOT_FOUND", "preset not found");
      if (row.owner !== userId) {
        throw row.owner === null
          ? new EqError("FORBIDDEN", "system preset cannot be deleted")
          : new EqError("NOT_FOUND", "preset not found");
      }
      presets.delete(id);
      return { wasActive: active.get(userId) === id };
    },
    async getActivePresetId(userId) {
      return active.get(userId) ?? null;
    },
    async setActivePreset(userId, presetId) {
      if (presetId !== null) {
        const row = presets.get(presetId);
        if (!row || (row.owner !== null && row.owner !== userId)) {
          throw new EqError("NOT_FOUND", "preset not found");
        }
      }
      active.set(userId, presetId);
      const s = { ...settingsOf(userId), activeEqPresetId: presetId };
      settings.set(userId, s);
      return {
        settings: s,
        presetId,
        bands: presetId === null ? null : [...presets.get(presetId)!.bands],
      };
    },
    async getSettings(userId) {
      return settingsOf(userId);
    },
    async patchSettings(userId, patch) {
      const s = { ...settingsOf(userId), ...patch };
      settings.set(userId, s);
      return s;
    },
  };
}

function makeRepos(): AppDeps["playerRepos"] {
  const snapshots = new Map<string, QueueSnapshot>();
  return {
    findTrack: async () => null,
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

/** WS broadcast test ต้องมี player block ด้วย (attachRealtime ลงทะเบียนในนั้น) */
function makeWsApp() {
  const eq = makeEqService();
  const app = buildApp(ENV, { playerRepos: makeRepos(), eq });
  return { app, eq };
}

async function listen(app: ReturnType<typeof buildApp>): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function connect(url: string, token: string): Socket {
  return ioClient(url, {
    path: "/ws",
    transports: ["websocket"],
    auth: { token },
    reconnection: false,
    timeout: 2000,
  });
}

function nextEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}

describe("REST — settings + eq presets (api.md §10 #38–44)", () => {
  let app: ReturnType<typeof buildApp>;
  let eq: EqService;
  let token: string;

  beforeEach(() => {
    eq = makeEqService();
    app = buildApp(ENV, { eq });
    token = signJwt("user-1", JWT_SECRET, 60_000);
  });
  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("GET /settings ไม่มี token → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /settings → UserSettingsDTO ครบ + PATCH ปรับ volume/muted/autoplay", async () => {
    const got = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: auth(),
    });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({
      volume: 80,
      muted: false,
      activeEqPresetId: null,
    });

    const patched = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: auth(),
      payload: { volume: 50, autoplay: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ volume: 50, autoplay: false, muted: false });
  });

  it("PATCH /settings locale → กลับค่าที่ตั้ง / แปลกปลอม → 400", async () => {
    const ok = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: auth(),
      payload: { locale: "en" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().locale).toBe("en");

    const bad = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: auth(),
      payload: { locale: "jp" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("PATCH /settings ค่าผิด range → 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: auth(),
      payload: { volume: 500 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /eq/presets → system + custom", async () => {
    await eq.createPreset("user-1", {
      name: "Mine",
      bands: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/eq/presets",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const { presets } = res.json() as { presets: EqPresetDTO[] };
    expect(presets.map((p) => p.name)).toEqual(["Bass Boost", "Flat", "Mine"]);
    expect(presets.find((p) => p.name === "Flat")!.isSystem).toBe(true);
    expect(presets.find((p) => p.name === "Mine")!.isSystem).toBe(false);
  });

  it("POST /eq/presets → 201 / ชื่อซ้ำ 409 / bands พัง 400", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/eq/presets",
      headers: auth(),
      payload: { name: "Mine", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ name: "Mine", isSystem: false });

    const dup = await app.inject({
      method: "POST",
      url: "/api/v1/eq/presets",
      headers: auth(),
      payload: { name: "Mine", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("EQ_PRESET_NAME_TAKEN");

    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/eq/presets",
      headers: auth(),
      payload: { name: "Other", bands: [0, 0, 0] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("PATCH /eq/presets/:id → แก้ได้ / system 403 / ไม่มี 404", async () => {
    const created = await eq.createPreset("user-1", {
      name: "Mine",
      bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    const ok = await app.inject({
      method: "PATCH",
      url: `/api/v1/eq/presets/${created.id}`,
      headers: auth(),
      payload: { bands: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().bands[0]).toBe(3);

    const system = await app.inject({
      method: "PATCH",
      url: `/api/v1/eq/presets/${FLAT_ID}`,
      headers: auth(),
      payload: { name: "Hacked" },
    });
    expect(system.statusCode).toBe(403);

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/v1/eq/presets/99999999-9999-4999-8999-999999999999",
      headers: auth(),
      payload: { name: "X" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("DELETE /eq/presets/:id → custom 204 / system 403", async () => {
    const created = await eq.createPreset("user-1", {
      name: "Mine",
      bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    const system = await app.inject({
      method: "DELETE",
      url: `/api/v1/eq/presets/${FLAT_ID}`,
      headers: auth(),
    });
    expect(system.statusCode).toBe(403);

    const ok = await app.inject({
      method: "DELETE",
      url: `/api/v1/eq/presets/${created.id}`,
      headers: auth(),
    });
    expect(ok.statusCode).toBe(204);
  });

  it("PUT /eq/active → settings กลับมาพร้อม activeEqPresetId / null = flat / ไม่พบ 404", async () => {
    const set = await app.inject({
      method: "PUT",
      url: "/api/v1/eq/active",
      headers: auth(),
      payload: { presetId: BASS_ID },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ activeEqPresetId: BASS_ID });

    const flat = await app.inject({
      method: "PUT",
      url: "/api/v1/eq/active",
      headers: auth(),
      payload: { presetId: null },
    });
    expect(flat.statusCode).toBe(200);
    expect(flat.json().activeEqPresetId).toBeNull();

    const missing = await app.inject({
      method: "PUT",
      url: "/api/v1/eq/active",
      headers: auth(),
      payload: { presetId: "99999999-9999-4999-8999-999999999999" },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe("WS — EQ_CHANGED broadcast (websocket.md §3)", () => {
  let app: ReturnType<typeof buildApp>;
  let url: string;
  let tokenA: string; // user-1
  let tokenB: string; // user-1 (อีก tab)
  let tokenC: string; // user-2

  beforeEach(async () => {
    ({ app } = makeWsApp());
    url = await listen(app);
    tokenA = signJwt("user-1", JWT_SECRET, 60_000);
    tokenB = signJwt("user-1", JWT_SECRET, 60_000);
    tokenC = signJwt("user-2", JWT_SECRET, 60_000);
  });
  afterEach(async () => {
    await app.close();
  });

  it("PUT /eq/active → ทุก tab ของ user ได้ EQ_CHANGED (version + bands), user อื่นเงียบ", async () => {
    const tabA = connect(url, tokenA);
    const tabB = connect(url, tokenB);
    const other = connect(url, tokenC);
    await Promise.all([
      new Promise((r) => tabA.on("connect", () => r(undefined))),
      new Promise((r) => tabB.on("connect", () => r(undefined))),
      new Promise((r) => other.on("connect", () => r(undefined))),
    ]);

    const changedA = nextEvent<{
      presetId: string | null;
      bands: number[] | null;
      version: number;
    }>(tabA, RealtimeEvents.EqChanged);
    const changedB = nextEvent<{
      presetId: string | null;
      bands: number[] | null;
      version: number;
    }>(tabB, RealtimeEvents.EqChanged);
    let otherHeard = false;
    other.onAny(() => {
      otherHeard = true;
    });

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/eq/active",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { presetId: BASS_ID },
    });
    expect(res.statusCode).toBe(200);

    const [a, b] = await Promise.all([changedA, changedB]);
    expect(a.presetId).toBe(BASS_ID);
    expect(a.bands).toEqual([8, 6, 4, 2, 0, 0, 0, 0, 0, 0]);
    expect(a.version).toBeGreaterThan(0);
    expect(b.version).toBe(a.version);
    await new Promise((r) => setTimeout(r, 100));
    expect(otherHeard).toBe(false);

    tabA.close();
    tabB.close();
    other.close();
  });
});

// ---------- Phase 11: PATCH /settings { autoplay } → PlayerService (app wiring) ----------
describe("PATCH /settings { autoplay } → player in-memory settings", () => {
  it("ปิด autoplay ผ่าน /settings แล้ว GET /player ต้องสะท้อนค่าใหม่", async () => {
    const app = buildApp(ENV, { playerRepos: makeRepos(), eq: makeEqService() });
    const token = signJwt("user-1", JWT_SECRET, 60_000);
    const auth = { authorization: `Bearer ${token}` };
    const patched = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: auth,
      payload: { autoplay: false },
    });
    expect(patched.statusCode).toBe(200);
    const player = await app.inject({
      method: "GET",
      url: "/api/v1/player",
      headers: auth,
    });
    expect(player.json().autoplay).toBe(false);
    await app.close();
  });
});
