import { randomBytes, createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { signJwt } from "./jwt.js";
import type { PublicUser } from "../../repositories/users.repo.js";
import type { RefreshTokenRow } from "../../repositories/refreshTokens.repo.js";

/** error ของ auth flow — route แปลงเป็น error shape กลางด้วย code ที่กำหนด */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHENTICATED" | "EMAIL_TAKEN" | "VALIDATION_ERROR",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthDeps {
  /** repositories — inject เป็น interface เพื่อให้ unit test ได้โดยไม่แตะ DB */
  findUserByEmail(
    email: string,
  ): Promise<(PublicUser & { passwordHash: string }) | undefined>;
  findUserById(id: string): Promise<PublicUser | undefined>;
  createUser(input: {
    email: string;
    passwordHash: string;
    displayName: string;
  }): Promise<PublicUser>;
  createRefreshToken(input: {
    userId: string;
    tokenHash: string;
    seriesId: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRow>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRow | undefined>;
  revokeRefreshToken(id: string): Promise<void>;
  revokeSeries(seriesId: string): Promise<void>;
}

export interface AuthSecrets {
  jwtSecret: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * AuthService ตาม backend.md §2 + ADR-006:
 * access token = JWT 15 นาที (จำใน memory), refresh token = opaque 30 วัน (httpOnly cookie)
 * rotate ทุกครั้ง + reuse detection → revoke ทั้ง series
 */
export function createAuthService(deps: AuthDeps, secrets: AuthSecrets) {
  function issueTokens(user: { id: string }, seriesId?: string): Promise<AuthTokens> {
    const series = seriesId ?? crypto.randomUUID();
    const refreshToken = opaqueToken();
    return deps
      .createRefreshToken({
        userId: user.id,
        tokenHash: sha256(refreshToken),
        seriesId: series,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      })
      .then(() => ({
        accessToken: signJwt(user.id, secrets.jwtSecret, ACCESS_TTL_MS),
        refreshToken,
      }));
  }

  async function register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<AuthTokens> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AuthError("Invalid email", "VALIDATION_ERROR");
    }
    if (input.password.length < 8) {
      throw new AuthError("Password must be at least 8 characters", "VALIDATION_ERROR");
    }
    const displayName = input.displayName.trim();
    if (displayName.length < 1 || displayName.length > 100) {
      throw new AuthError("Invalid display name", "VALIDATION_ERROR");
    }
    const existing = await deps.findUserByEmail(email);
    if (existing) throw new AuthError("Email already taken", "EMAIL_TAKEN");
    const passwordHash = await hash(input.password);
    const user = await deps.createUser({ email, passwordHash, displayName });
    return issueTokens(user);
  }

  async function login(input: {
    email: string;
    password: string;
  }): Promise<AuthTokens> {
    const email = input.email.trim().toLowerCase();
    const user = await deps.findUserByEmail(email);
    // ตอบเหมือนกันทั้งกรณี "ไม่มี user" และ "รหัสผ่านผิด" (กัน user enumeration)
    const authError = new AuthError("Invalid email or password", "UNAUTHENTICATED");
    if (!user) throw authError;
    const valid = await verify(user.passwordHash, input.password).catch(() => false);
    if (!valid) throw authError;
    return issueTokens({ id: user.id });
  }

  async function refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const tokenHash = sha256(rawRefreshToken);
    const row = await deps.findRefreshTokenByHash(tokenHash);
    if (!row) throw new AuthError("Invalid refresh token", "UNAUTHENTICATED");
    if (row.revokedAt || row.expiresAt.getTime() < Date.now()) {
      // reuse detection: token ถูกใช้แล้ว/หมดอายุ → ถือว่า series ถูก compromise → revoke ทั้ง series
      await deps.revokeSeries(row.seriesId);
      throw new AuthError("Refresh token reuse detected", "UNAUTHENTICATED");
    }
    await deps.revokeRefreshToken(row.id);
    return issueTokens({ id: row.userId }, row.seriesId);
  }

  async function logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const row = await deps.findRefreshTokenByHash(sha256(rawRefreshToken));
    if (row) await deps.revokeSeries(row.seriesId);
  }

  async function me(userId: string): Promise<PublicUser> {
    const user = await deps.findUserById(userId);
    if (!user) throw new AuthError("User not found", "UNAUTHENTICATED");
    return user;
  }

  /**
   * ตรวจ refresh cookie แบบ read-only (ไม่ rotate) — ใช้กับ /stream
   * (security.md §8.6: /stream ใช้ session cookie ตัวเดียวกับ flow auth)
   */
  async function validateSession(rawToken: string): Promise<string | null> {
    const row = await deps.findRefreshTokenByHash(sha256(rawToken));
    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return null;
    return row.userId;
  }

  return { register, login, refresh, logout, me, validateSession };
}

export { verifyJwt } from "./jwt.js";
export const REFRESH_COOKIE_NAME = "refresh_token";
export { ACCESS_TTL_MS, REFRESH_TTL_MS };
