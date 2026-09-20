import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { buildApp } from "../app.js";
import { StreamError } from "../services/StreamService.js";
import { createAuthService } from "../services/auth/AuthService.js";

const UUID = "11111111-1111-1111-1111-111111111111";
const testEnv = {
  RESOLVER_URL: "http://unused",
  LAVALINK_URL: "http://unused",
  LAVALINK_PASSWORD: "x",
  JWT_SECRET: "test-jwt-secret-with-32-chars-min!!",
  REFRESH_SECRET: "test-refresh-secret-32-chars-min!!",
};

function makeStreamDeps(openStreamImpl?: Parameters<typeof vi.fn>[0]) {
  const validateSession = vi.fn(async (token: string) =>
    token === "valid-cookie" ? "user-1" : null,
  );
  const openStream = vi.fn(openStreamImpl);
  return { validateSession, openStream };
}

function appWith(streamDeps: ReturnType<typeof makeStreamDeps>) {
  return buildApp(testEnv, { stream: streamDeps as never });
}

describe("GET /api/v1/stream/:trackId", () => {
  it("ไม่มี cookie → 401 UNAUTHENTICATED (security.md §8.6)", async () => {
    const app = appWith(makeStreamDeps());
    const res = await app.inject({ method: "GET", url: `/api/v1/stream/${UUID}` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
    await app.close();
  });

  it("cookie ไม่ถูกต้อง → 401", async () => {
    const app = appWith(makeStreamDeps());
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/stream/${UUID}`,
      cookies: { refresh_token: "bogus" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("trackId ไม่ใช่ UUID → 400", async () => {
    const app = appWith(makeStreamDeps());
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/stream/not-a-uuid",
      cookies: { refresh_token: "valid-cookie" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("เล่นได้: hijack raw response — 206 + bytes จริง + Range ถูก forward", async () => {
    const deps = makeStreamDeps(async (trackId: string, range?: string) => {
      expect(trackId).toBe(UUID);
      expect(range).toBe("bytes=0-");
      const stream = new PassThrough();
      stream.write(Buffer.from("audio-audio-audio"));
      stream.end();
      return {
        statusCode: 206,
        headers: { "content-type": "audio/webm", "content-range": "bytes 0-16/17" },
        stream,
      };
    });
    const app = appWith(deps);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/stream/${UUID}`,
      headers: { range: "bytes=0-" },
      cookies: { refresh_token: "valid-cookie" },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-type"]).toBe("audio/webm");
    expect(res.body).toBe("audio-audio-audio");
    await app.close();
  });

  it.each([
    [new StreamError("Upstream stream unavailable", "UPSTREAM_UNAVAILABLE"), 503],
    [new StreamError("Track not found", "NOT_FOUND"), 404],
    [new StreamError("not allowed", "TRACK_UNPLAYABLE"), 422],
  ])("StreamError %s → HTTP %i", async (error, expectedStatus) => {
    const deps = makeStreamDeps(async () => {
      throw error;
    });
    const app = appWith(deps);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/stream/${UUID}`,
      cookies: { refresh_token: "valid-cookie" },
    });
    expect(res.statusCode).toBe(expectedStatus);
    expect(res.json().error.code).toBe((error as StreamError).code);
    await app.close();
  });

  it("rate limit: เกิน 60 req/min → 429", async () => {
    const deps = makeStreamDeps(async () => {
      const stream = new PassThrough();
      stream.end("x");
      return { statusCode: 200, headers: { "content-type": "audio/webm" }, stream };
    });
    const app = appWith(deps);
    let lastStatus = 0;
    for (let i = 0; i < 62; i++) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/stream/${UUID}`,
        cookies: { refresh_token: "valid-cookie" },
      });
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
    await app.close();
  });

  it("concurrent ≤ 2: สตรีมที่ 3 พร้อมกัน → 429", async () => {
    const pending: Array<{ stream: PassThrough }> = [];
    const deps = makeStreamDeps(async () => {
      const stream = new PassThrough();
      pending.push({ stream });
      return { statusCode: 200, headers: { "content-type": "audio/webm" }, stream };
    });
    const app = appWith(deps);

    const r1 = app.inject({
      method: "GET",
      url: `/api/v1/stream/${UUID}`,
      cookies: { refresh_token: "valid-cookie" },
    });
    const r2 = app.inject({
      method: "GET",
      url: `/api/v1/stream/${UUID}`,
      cookies: { refresh_token: "valid-cookie" },
    });
    await vi.waitFor(() => expect(deps.openStream).toHaveBeenCalledTimes(2));

    const r3 = await app.inject({
      method: "GET",
      url: `/api/v1/stream/${UUID}`,
      cookies: { refresh_token: "valid-cookie" },
    });
    expect(r3.statusCode).toBe(429);

    for (const p of pending) p.stream.end();
    await r1;
    await r2;
    await app.close();
  });
});

describe("auth routes (contract)", () => {
  // ใช้ AuthService จริงกับ in-memory deps — ทดสอบ cookie flow ผ่าน HTTP จริง
  function authDeps() {
    const usersByEmail = new Map<
      string,
      { id: string; email: string; displayName: string; passwordHash: string }
    >();
    const tokensByHash = new Map<
      string,
      {
        id: string;
        userId: string;
        tokenHash: string;
        seriesId: string;
        expiresAt: Date;
        revokedAt: Date | null;
      }
    >();
    let seq = 0;
    const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
    const auth = createAuthService(
      {
        async findUserByEmail(email) {
          return usersByEmail.get(email);
        },
        async findUserById(id) {
          for (const u of usersByEmail.values()) {
            if (u.id === id)
              return { id: u.id, email: u.email, displayName: u.displayName };
          }
          return undefined;
        },
        async createUser(input) {
          const user = { id: `user-${++seq}`, ...input };
          usersByEmail.set(input.email, user);
          return { id: user.id, email: user.email, displayName: user.displayName };
        },
        async createRefreshToken(input) {
          const row = { id: `t-${++seq}`, revokedAt: null, ...input };
          tokensByHash.set(input.tokenHash, row);
          return row;
        },
        async findRefreshTokenByHash(tokenHash) {
          return tokensByHash.get(tokenHash);
        },
        async revokeRefreshToken(id) {
          for (const row of tokensByHash.values())
            if (row.id === id) row.revokedAt = new Date();
        },
        async revokeSeries(seriesId) {
          for (const row of tokensByHash.values())
            if (row.seriesId === seriesId) row.revokedAt = new Date();
        },
      },
      { jwtSecret: testEnv.JWT_SECRET },
    );
    return { auth, sha256 };
  }

  it("register → cookie → refresh rotate → reuse → 401", async () => {
    const { auth, sha256 } = authDeps();
    const app = buildApp(testEnv, {
      auth: { ...auth, jwtSecret: testEnv.JWT_SECRET } as never,
    });

    const registerRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "u@test.com", password: "password123", displayName: "U" },
    });
    expect(registerRes.statusCode).toBe(200);
    expect(registerRes.json().accessToken).toBeTruthy();
    const cookie1 = registerRes.cookies.find((c) => c.name === "refresh_token")!.value;
    expect(cookie1).toBeTruthy();

    // refresh → rotate (cookie ใหม่)
    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { refresh_token: cookie1 },
    });
    expect(refreshRes.statusCode).toBe(200);
    const cookie2 = refreshRes.cookies.find((c) => c.name === "refresh_token")!.value;
    expect(cookie2).not.toBe(cookie1);

    // reuse ตัวเก่า → 401 + ทั้ง series โดน revoke
    const reuseRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { refresh_token: cookie1 },
    });
    expect(reuseRes.statusCode).toBe(401);

    const afterReuse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { refresh_token: cookie2 },
    });
    expect(afterReuse.statusCode).toBe(401);
    expect(sha256("")).toHaveLength(64);
    await app.close();
  });

  it("register: email ซ้ำ → 409 EMAIL_TAKEN; login ผิด → 401", async () => {
    const { auth } = authDeps();
    const app = buildApp(testEnv, {
      auth: { ...auth, jwtSecret: testEnv.JWT_SECRET } as never,
    });

    const payload = { email: "u@test.com", password: "password123", displayName: "U" };
    await app.inject({ method: "POST", url: "/api/v1/auth/register", payload });

    const dup = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("EMAIL_TAKEN");

    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "u@test.com", password: "wrong-password" },
    });
    expect(bad.statusCode).toBe(401);
    await app.close();
  });

  it("GET /me ด้วย Bearer token ที่ถูกต้อง; ไม่มี token → 401", async () => {
    const { auth } = authDeps();
    const app = buildApp(testEnv, {
      auth: { ...auth, jwtSecret: testEnv.JWT_SECRET } as never,
    });

    const registerRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "me@test.com", password: "password123", displayName: "Me" },
    });
    const accessToken = registerRes.json().accessToken as string;

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      id: expect.any(String),
      email: "me@test.com",
      displayName: "Me",
    });

    const anon = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(anon.statusCode).toBe(401);
    await app.close();
  });
});
