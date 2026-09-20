import { refreshTokens } from "../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";

export interface RefreshTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  seriesId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export async function createRefreshToken(
  db: Db,
  input: { userId: string; tokenHash: string; seriesId: string; expiresAt: Date },
): Promise<RefreshTokenRow> {
  const [row] = await db.insert(refreshTokens).values(input).returning({
    id: refreshTokens.id,
    userId: refreshTokens.userId,
    tokenHash: refreshTokens.tokenHash,
    seriesId: refreshTokens.seriesId,
    expiresAt: refreshTokens.expiresAt,
    revokedAt: refreshTokens.revokedAt,
  });
  if (!row) throw new Error("createRefreshToken: no row returned");
  return row;
}

export async function findRefreshTokenByHash(
  db: Db,
  tokenHash: string,
): Promise<RefreshTokenRow | undefined> {
  const [row] = await db
    .select({
      id: refreshTokens.id,
      userId: refreshTokens.userId,
      tokenHash: refreshTokens.tokenHash,
      seriesId: refreshTokens.seriesId,
      expiresAt: refreshTokens.expiresAt,
      revokedAt: refreshTokens.revokedAt,
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function revokeRefreshToken(db: Db, id: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));
}

/** revoke ทั้ง series — ใช้เมื่อตรวจจับ reuse หรือ logout */
export async function revokeSeries(db: Db, seriesId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.seriesId, seriesId)));
}
