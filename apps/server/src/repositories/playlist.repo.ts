/**
 * repo ฝั่ง playlists — playlists + playlist_tracks (database.md §2.3/§2.4)
 * soft delete (is_deleted) — unique(user_id, name) มี WHERE is_deleted = false ใน migration
 * UNIQUE(playlist_id, position) → ทุกการแก้ลำดับทำใน transaction แบบ two-phase กันชน
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { PlaylistDTO, TrackDTO } from "@musicplayer/shared";
import type { Db } from "../db/client.js";
import { playlistTracks, playlists, tracks } from "../db/schema.js";
import { trackDtoColumns, toTrackDTO } from "./tracks.repo.js";
import { likedTrackIds } from "./likes.repo.js";

type PlaylistRow = typeof playlists.$inferSelect;

function toDto(row: PlaylistRow, trackCount: number): PlaylistDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    coverUrl: row.coverUrl,
    trackCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** รายการ playlist ของ user (ใหม่ → เก่าตาม updatedAt) พร้อมจำนวนเพลง */
export async function listPlaylists(db: Db, userId: string): Promise<PlaylistDTO[]> {
  const rows = await db
    .select({
      playlist: playlists,
      trackCount: sql<number>`(
        select count(*)::int from ${playlistTracks}
        where ${playlistTracks.playlistId} = ${playlists.id}
      )`,
    })
    .from(playlists)
    .where(and(eq(playlists.userId, userId), eq(playlists.isDeleted, false)))
    .orderBy(desc(playlists.updatedAt));
  return rows.map((r) => toDto(r.playlist, r.trackCount));
}

export async function findPlaylistRow(db: Db, id: string): Promise<PlaylistRow | null> {
  const [row] = await db
    .select()
    .from(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.isDeleted, false)))
    .limit(1);
  return row ?? null;
}

export async function findPlaylistByName(
  db: Db,
  userId: string,
  name: string,
): Promise<PlaylistRow | null> {
  const [row] = await db
    .select()
    .from(playlists)
    .where(
      and(
        eq(playlists.userId, userId),
        eq(playlists.name, name),
        eq(playlists.isDeleted, false),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createPlaylistRow(
  db: Db,
  userId: string,
  input: { name: string; description?: string | null },
): Promise<PlaylistDTO> {
  const now = new Date();
  const [row] = await db
    .insert(playlists)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("createPlaylistRow: no row returned");
  return toDto(row, 0);
}

export async function updatePlaylistById(
  db: Db,
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<void> {
  await db
    .update(playlists)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(playlists.id, id));
}

/** soft delete — queue/history อ้าง playlist id ได้ต่อ (database.md §2.3) */
export async function softDeletePlaylist(db: Db, id: string): Promise<void> {
  await db
    .update(playlists)
    .set({ isDeleted: true, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(playlists.id, id));
}

export async function countPlaylistTracks(db: Db, playlistId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId));
  return row?.count ?? 0;
}

export interface PlaylistItemRow {
  /** id ของ playlist_tracks (ใช้ remove/reorder อ้าง) */
  id: string;
  track: TrackDTO;
}

/** เพลงใน playlist เรียงตาม position + เติม isLiked (database.md §2.4) */
export async function listPlaylistItems(
  db: Db,
  playlistId: string,
  userId: string,
): Promise<PlaylistItemRow[]> {
  const rows = await db
    .select({ itemId: playlistTracks.id, ...trackDtoColumns })
    .from(playlistTracks)
    .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(asc(playlistTracks.position));
  if (rows.length === 0) return [];
  const liked = await likedTrackIds(
    db,
    userId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.itemId,
    track: toTrackDTO(r, liked.has(r.id)),
  }));
}

/** ตำแหน่งสูงสุดปัจจุบัน (append ต่อท้าย) — -1 เมื่อว่าง */
export async function maxPlaylistPosition(db: Db, playlistId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${playlistTracks.position})` })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId));
  return row?.max ?? -1;
}

/** เพิ่มเพลงต่อท้าย — trackIds ต้องผ่านตรวจว่ามีใน tracks แล้ว (service ตรวจ) */
export async function appendPlaylistTracks(
  db: Db,
  playlistId: string,
  trackIds: string[],
): Promise<void> {
  if (trackIds.length === 0) return;
  const start = (await maxPlaylistPosition(db, playlistId)) + 1;
  await db.insert(playlistTracks).values(
    trackIds.map((trackId, i) => ({
      playlistId,
      trackId,
      position: start + i,
    })),
  );
}

/** ลบ item (ตาม playlist_tracks.id) แล้ว pack position ใหม่ 0..n-1 (transaction) */
export async function removePlaylistItems(
  db: Db,
  playlistId: string,
  itemIds: string[],
): Promise<void> {
  if (itemIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx
      .delete(playlistTracks)
      .where(
        and(
          eq(playlistTracks.playlistId, playlistId),
          inArray(playlistTracks.id, itemIds),
        ),
      );
    await repackPositions(tx, playlistId);
  });
}

async function repackPositions(tx: Db, playlistId: string): Promise<void> {
  const rows = await tx
    .select({ id: playlistTracks.id })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(asc(playlistTracks.position));
  for (const [i, row] of rows.entries()) {
    await tx
      .update(playlistTracks)
      .set({ position: i })
      .where(eq(playlistTracks.id, row.id));
  }
}

/**
 * จัดลำดับใหม่ตาม orderedItemIds (id ชุดเดียวกับของเดิม — service ตรวจ) — transaction
 * two-phase: ตั้ง negative ก่อนเพื่อไม่ชน UNIQUE(playlist_id, position) ระหว่าง update
 */
export async function reorderPlaylistItems(
  db: Db,
  playlistId: string,
  orderedItemIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [i, id] of orderedItemIds.entries()) {
      await tx
        .update(playlistTracks)
        .set({ position: -(i + 1) })
        .where(
          and(eq(playlistTracks.id, id), eq(playlistTracks.playlistId, playlistId)),
        );
    }
    for (const [i, id] of orderedItemIds.entries()) {
      await tx
        .update(playlistTracks)
        .set({ position: i })
        .where(eq(playlistTracks.id, id));
    }
  });
}

/** id เพลงใน playlist เรียงตาม position (ใช้ POST /queue/tracks {playlistId}) */
export async function playlistTrackIds(db: Db, playlistId: string): Promise<string[]> {
  const rows = await db
    .select({ trackId: playlistTracks.trackId })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, playlistId))
    .orderBy(asc(playlistTracks.position));
  return rows.map((r) => r.trackId);
}

/** track ที่มีจริงจาก ids (ตามลำดับที่ส่ง) — service ใช้ตรวจก่อน append */
export async function findExistingTrackIds(
  db: Db,
  trackIds: string[],
): Promise<Set<string>> {
  if (trackIds.length === 0) return new Set();
  const rows = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(inArray(tracks.id, trackIds));
  return new Set(rows.map((r) => r.id));
}
