/**
 * Security hardening contract tests (Phase 13 — security.md §3/§10, api.md §12)
 * headers (nosniff/referrer) · login rate limit 5/min/IP · account lockout 10 fail/15 นาที
 * (error generic ไม่ leak) · command rate limit 60/min/user
 */
import { describe, expect, it } from "vitest";
import { signJwt } from "../services/auth/jwt.js";
import { buildApp } from "../app.js";
import { createPlayerService } from "../services/PlayerService.js";
import { AuthGuard, AccountLockout } from "../security/authGuard.js";
import { CommandGuard } from "../security/commandGuard.js";
import type { AuthRoutesDeps } from "./auth.routes.js";
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

const testEnv = {
  CORS_ORIGIN: undefined,
  RESOLVER_URL: "http://unused",
  LAVALINK_URL: "http://unused",
  LAVALINK_PASSWORD: "x",
  JWT_SECRET: "test-jwt-secret-with-32-chars-min!!",
  REFRESH_SECRET: "test-refresh-secret-32-chars-min!!",
};

function fakeAuth(over: Partial<AuthRoutesDeps> = {}): AuthRoutesDeps {
  const users = new Map<string, string>([["demo@example.com", "pw-12345678"]]);
  return {
    register: async () => ({
      accessToken: "x",
      refreshToken: "r",
    }),
    login: async (input) => {
      if (users.get(input.email) !== input.password) {
        throw new (await import("../services/auth/AuthService.js")).AuthError(
          "Invalid email or password",
          "UNAUTHENTICATED",
        );
      }
      return { accessToken: "a", refreshToken: "r" };
    },
    refresh: async () => ({ accessToken: "a", refreshToken: "r" }),
    logout: async () => undefined,
    me: async () => ({ id: "u", email: "e", displayName: "n" }),
    jwtSecret: testEnv.JWT_SECRET,
    ...over,
  };
}

describe("security headers (security.md §10)", () => {
  it("ทุก response ของ API มี nosniff + Referrer-Policy", async () => {
    const app = buildApp(testEnv, {});
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    await app.close();
  });
});

describe("login rate limit 5/min/IP (security.md §3)", () => {
  it("login ครบ 5 ครั้งใน 1 นาที → ครั้งที่ 6 เป็น 429 RATE_LIMITED", async () => {
    const app = buildApp(testEnv, {
      auth: fakeAuth({ loginGuard: new AuthGuard(5) }),
    } as never);
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "demo@example.com", password: "wrong" },
      });
      expect(res.statusCode).toBe(401);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "demo@example.com", password: "pw-12345678" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    await app.close();
  });
});

describe("account lockout 10 fail/15 นาที (security.md §3)", () => {
  it("fail ครบ 10 → รหัสถูกต้องก็ยัง 401 generic เดิม, reset ล้าง", async () => {
    const lockout = new AccountLockout(10);
    const app = buildApp(testEnv, { auth: fakeAuth({ lockout }) } as never);
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "demo@example.com", password: "wrong" },
      });
      expect(res.statusCode).toBe(401);
    }
    // ถูก lock: รหัสถูกต้องก็ได้ error เดียวกับรหัสผิด (ไม่ leak สถานะ lock)
    const locked = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "demo@example.com", password: "pw-12345678" },
    });
    expect(locked.statusCode).toBe(401);
    expect(locked.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Invalid email or password" },
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "demo@example.com", password: "also-wrong" },
    });
    expect(wrong.json()).toEqual(locked.json());
    await app.close();
  });

  it("login สำเร็จ → ล้างประวัติ fail (ไม่ถูก lock จาก fail เก่า)", async () => {
    const lockout = new AccountLockout(3);
    const app = buildApp(testEnv, { auth: fakeAuth({ lockout }) } as never);
    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "demo@example.com", password: "wrong" },
      });
    }
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "demo@example.com", password: "pw-12345678" },
    });
    expect(ok.statusCode).toBe(200);
    // หลังสำเร็จ: fail 2 ครั้งอีกไม่ lock (ประวัติถูก reset)
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "demo@example.com", password: "wrong" },
      });
      expect(res.statusCode).toBe(401);
    }
    const okAgain = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "demo@example.com", password: "pw-12345678" },
    });
    expect(okAgain.statusCode).toBe(200);
    await app.close();
  });
});

describe("command rate limit 60/min/user (api.md §12)", () => {
  it("คำสั่งเกิน limit → 429, GET ไม่นับ", async () => {
    const jwtSecret = testEnv.JWT_SECRET;
    const token = signJwt("user-1", jwtSecret, 60_000);
    const player = createPlayerService({
      findTrack: async () => T1,
      getSettings: async () => ({
        volume: 80,
        muted: false,
        repeatMode: "off" as const,
        shuffle: false,
        autoplay: true,
      }),
      saveSettings: async () => undefined,
      loadQueue: async () => null,
      saveQueue: async () => undefined,
    });
    const app = buildApp(testEnv, {
      commandGuard: new CommandGuard(3),
      player: { jwtSecret, player },
    });
    const authed = { authorization: `Bearer ${token}` };
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/player/play",
        payload: { trackId: T1.id },
        headers: authed,
      });
      expect(res.statusCode).toBe(200);
    }
    // GET ไม่นับ → ยัง 200 แม้ครบ limit
    const status = await app.inject({
      method: "GET",
      url: "/api/v1/player",
      headers: authed,
    });
    expect(status.statusCode).toBe(200);
    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/player/play",
      payload: { trackId: T1.id },
      headers: authed,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    await app.close();
  });
});
