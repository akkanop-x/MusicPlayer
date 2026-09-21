/**
 * repo ฝั่ง likes — liked_tracks (database.md §2.5)
 * PK (user_id, track_id) → PUT/DELETE idempotent ตาม api.md §8;
 * likedAt เรียง DESC ด้วย index (user_id, liked_at DESC) — cursor pagination
 */
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { LikeEntryDTO } from "@musicplayer/shared";
import type { Db } from "../db/client.js";
import { likedTracks, tracks } from "../db/schema.js";
import { trackDtoColumns, toTrackDTO } from "./tracks.repo.js";

/** like — คืน likedAt (ของเดิมถ้า like ซ้ำ) + ตัวบอกว่าเป็นการ like ใหม่หรือไม่ */
export async function likeTrackRow(
  db: Db,
  userId: string,
  trackId: string,
): Promise<{ likedAt: Date; alreadyLiked: boolean }> {
  const inserted = await db
    .insert(likedTracks)
    .values({ userId, trackId })
    .onConflictDoNothing()
    .returning({ likedAt: likedTracks.likedAt });
  const [row] = inserted;
  if (row) return { likedAt: row.likedAt, alreadyLiked: false };
  const [existing] = await db
    .select({ likedAt: likedTracks.likedAt })
    .from(likedTracks)
    .where(and(eq(likedTracks.userId, userId), eq(likedTracks.trackId, trackId)))
    .limit(1);
  if (!existing) throw new Error("likeTrackRow: no row after conflict");
  return { likedAt: existing.likedAt, alreadyLiked: true };
}

/** unlike — idempotent: ไม่มีอยู่แล้วคืน false (ยังคืน 200 ตาม api.md) */
export async function unlikeTrackRow(
  db: Db,
  userId: string,
  trackId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(likedTracks)
    .where(and(eq(likedTracks.userId, userId), eq(likedTracks.trackId, trackId)))
    .returning({ trackId: likedTracks.trackId });
  return deleted.length > 0;
}

/** หน้า Liked เรียงใหม่ → เก่า (database.md §4); cursor = likedAt ISO ของ item สุดท้าย */
export async function listLikedTracks(
  db: Db,
  userId: string,
  options: { limit: number; cursor?: Date | null },
): Promise<LikeEntryDTO[]> {
  const conditions = [eq(likedTracks.userId, userId)];
  if (options.cursor) {
    conditions.push(lt(likedTracks.likedAt, options.cursor));
  }
  const rows = await db
    .select({ likedAt: likedTracks.likedAt, ...trackDtoColumns })
    .from(likedTracks)
    .innerJoin(tracks, eq(likedTracks.trackId, tracks.id))
    .where(and(...conditions))
    .orderBy(desc(likedTracks.likedAt))
    .limit(options.limit);
  return rows.map((r) => ({
    track: toTrackDTO(r, true),
    likedAt: r.likedAt.toISOString(),
  }));
}

/** id ชุดที่ user like จาก trackIds ที่สนใจ (batch decorate — database.md §4) */
export async function likedTrackIds(
  db: Db,
  userId: string,
  trackIds: string[],
): Promise<Set<string>> {
  if (trackIds.length === 0) return new Set();
  const rows = await db
    .select({ trackId: likedTracks.trackId })
    .from(likedTracks)
    .where(and(eq(likedTracks.userId, userId), inArray(likedTracks.trackId, trackIds)));
  return new Set(rows.map((r) => r.trackId));
}

/** track ที่มีอยู่จริงจาก ids — service ใช้ก่อน like (404 TRACK_NOT_FOUND) */
export async function findExistingTrackId(db: Db, trackId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(eq(tracks.id, trackId))
    .limit(1);
  return !!row;
}
