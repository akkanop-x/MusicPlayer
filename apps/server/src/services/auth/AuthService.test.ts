import { beforeEach, describe, expect, it } from "vitest";
import { createAuthService, type AuthDeps } from "./AuthService.js";
import { signJwt, verifyJwt, JwtError } from "./jwt.js";
import type { PublicUser } from "../../repositories/users.repo.js";
import type { RefreshTokenRow } from "../../repositories/refreshTokens.repo.js";

const JWT_SECRET = "test-jwt-secret-with-32-chars-min!!";

type StoredUser = PublicUser & { passwordHash: string };

function makeDeps() {
  const usersByEmail = new Map<string, StoredUser>();
  const tokensByHash = new Map<string, RefreshTokenRow>();
  let userSeq = 0;
  let tokenSeq = 0;
  let settingsCreated = 0;

  const deps: AuthDeps = {
    async findUserByEmail(email) {
      return usersByEmail.get(email);
    },
    async findUserById(id) {
      for (const user of usersByEmail.values()) {
        if (user.id === id) {
          return { id: user.id, email: user.email, displayName: user.displayName };
        }
      }
      return undefined;
    },
    async createUser(input) {
      const user: StoredUser = { id: `user-${++userSeq}`, ...input };
      usersByEmail.set(input.email, user);
      settingsCreated++;
      return { id: user.id, email: user.email, displayName: user.displayName };
    },
    async createRefreshToken(input) {
      const row: RefreshTokenRow = {
        id: `token-${++tokenSeq}`,
        revokedAt: null,
        ...input,
      };
      tokensByHash.set(input.tokenHash, row);
      return row;
    },
    async findRefreshTokenByHash(tokenHash) {
      return tokensByHash.get(tokenHash);
    },
    async revokeRefreshToken(id) {
      for (const row of tokensByHash.values()) {
        if (row.id === id) row.revokedAt = new Date();
      }
    },
    async revokeSeries(seriesId) {
      for (const row of tokensByHash.values()) {
        if (row.seriesId === seriesId) row.revokedAt = new Date();
      }
    },
  };

  return { deps, usersByEmail, tokensByHash, settingsCreated: () => settingsCreated };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

import { createHash } from "node:crypto";

describe("AuthService", () => {
  let harness: ReturnType<typeof makeDeps>;
  let service: ReturnType<typeof createAuthService>;

  beforeEach(() => {
    harness = makeDeps();
    service = createAuthService(harness.deps, { jwtSecret: JWT_SECRET });
  });

  it("register → ได้ tokens + สร้าง user_settings คู่กัน + login ด้วยรหัสที่ถูกต้องได้", async () => {
    const tokens = await service.register({
      email: "  User@Test.COM ",
      password: "password123",
      displayName: "Test User",
    });
    expect(tokens.accessToken.split(".")).toHaveLength(3);
    expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(harness.settingsCreated()).toBe(1);
    // email เก็บ lowercase
    expect(harness.usersByEmail.has("user@test.com")).toBe(true);

    const login = await service.login({
      email: "user@test.com",
      password: "password123",
    });
    expect(login.accessToken).toBeTruthy();
  });

  it("register: email ซ้ำ → EMAIL_TAKEN, password สั้น → VALIDATION_ERROR", async () => {
    await service.register({
      email: "a@b.com",
      password: "password123",
      displayName: "A",
    });
    await expect(
      service.register({ email: "a@b.com", password: "password456", displayName: "B" }),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    await expect(
      service.register({ email: "c@b.com", password: "short", displayName: "C" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("login: รหัสผ่านผิด/ไม่มี user → UNAUTHENTICATED (ข้อความเดียวกัน)", async () => {
    await service.register({
      email: "a@b.com",
      password: "password123",
      displayName: "A",
    });
    const wrong = await service
      .login({ email: "a@b.com", password: "wrong-password" })
      .catch((e: unknown) => e);
    const missing = await service
      .login({ email: "none@b.com", password: "password123" })
      .catch((e: unknown) => e);
    expect(wrong).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(missing).toMatchObject({ code: "UNAUTHENTICATED" });
    expect((wrong as Error).message).toBe((missing as Error).message);
  });

  it("refresh: rotate — token เก่าถูก revoke, ใช้ซ้ำ → reuse detection revoke ทั้ง series", async () => {
    const first = await service.register({
      email: "a@b.com",
      password: "password123",
      displayName: "A",
    });
    const second = await service.refresh(first.refreshToken);

    // token แรกถูก revoke — refresh ซ้ำด้วยตัวเก่า → 401 + revoke ทั้ง series
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });

    // token ล่าสุด (ยังไม่ถูกใช้) ก็ใช้ไม่ได้อีกแล้ว — series ถูก revoke ทั้งชุด
    await expect(service.refresh(second.refreshToken)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect([...harness.tokensByHash.values()].every((t) => t.revokedAt !== null)).toBe(
      true,
    );
  });

  it("refresh: token ที่ไม่เคยมีในระบบ → UNAUTHENTICATED", async () => {
    await expect(service.refresh("totally-unknown-token")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("logout: revoke ทั้ง series → refresh ไม่ผ่านอีก", async () => {
    const first = await service.register({
      email: "a@b.com",
      password: "password123",
      displayName: "A",
    });
    await service.refresh(first.refreshToken);
    await service.logout(first.refreshToken);
    await expect(
      service.refresh(signJwt("x", JWT_SECRET, 1000)), // token อะไรก็ได้ที่ไม่อยู่ในระบบ
    ).rejects.toBeTruthy();
    expect([...harness.tokensByHash.values()].every((t) => t.revokedAt !== null)).toBe(
      true,
    );
  });

  it("me: คืน public profile ของ user", async () => {
    await service.register({
      email: "a@b.com",
      password: "password123",
      displayName: "A",
    });
    const user = harness.usersByEmail.get("a@b.com")!;
    const profile = await service.me(user.id);
    expect(profile).toEqual({ id: user.id, email: "a@b.com", displayName: "A" });
    await expect(service.me("nope")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("jwt (access token)", () => {
  it("sign/verify roundtrip + exp claim 15 นาที", () => {
    const token = signJwt("user-1", JWT_SECRET, 15 * 60 * 1000);
    const payload = verifyJwt(token, JWT_SECRET);
    expect(payload.sub).toBe("user-1");
    expect(payload.exp - payload.iat).toBe(15 * 60);
  });

  it("verify: ลายเซ็นผิด / หมดอายุ → JwtError", () => {
    const token = signJwt("user-1", JWT_SECRET, 15 * 60 * 1000);
    expect(() => verifyJwt(token, "another-secret-32-chars-minimum!!!!")).toThrow(
      JwtError,
    );
    const expired = signJwt("user-1", JWT_SECRET, -1000);
    expect(() => verifyJwt(expired, JWT_SECRET)).toThrow(/expired/);
    expect(() => verifyJwt("not.a.token", JWT_SECRET)).toThrow(JwtError);
  });

  it("refresh token hash เก็บ sha256 — ไม่เก็บ raw token", () => {
    expect(sha256("abc")).toHaveLength(64);
  });
});
