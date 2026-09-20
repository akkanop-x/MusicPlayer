import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * JWT (HS256) แบบมินิมอลด้วย node:crypto — access token อายุสั้น (ADR-006)
 * ไม่เพิ่ม dependency; ใช้เฉพาะ sign/verify ที่เราควบคุมทั้งสองฝั่ง
 */
export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

export class JwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtError";
  }
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signJwt(sub: string, secret: string, ttlMs: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = { sub, iat: now, exp: now + Math.floor(ttlMs / 1000) };
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = hmac(`${head}.${body}`, secret);
  return `${head}.${body}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("malformed token");
  const [head, body, signature] = parts as [string, string, string];
  const expected = hmac(`${head}.${body}`, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new JwtError("invalid signature");
  }
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as JwtPayload;
  if (typeof parsed.exp !== "number" || parsed.exp * 1000 < Date.now()) {
    throw new JwtError("token expired");
  }
  if (typeof parsed.sub !== "string") throw new JwtError("invalid payload");
  return parsed;
}
