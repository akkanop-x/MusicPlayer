import { tracks } from "../db/schema.js";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { TrackDTO } from "@musicplayer/shared";
import type { Db } from "../db/client.js";

/** field ชุดเดียวกับ TrackDTO (isLiked เติมตอน Phase 10) — ใช้ร่วมกันหลาย query */
const dtoColumns = {
  id: tracks.id,
  title: tracks.title,
  artist: tracks.artist,
  album: tracks.album,
  durationMs: tracks.durationMs,
  isStream: tracks.isStream,
  isSeekable: tracks.isSeekable,
  artworkUrl: tracks.artworkUrl,
  sourceName: tracks.sourceName,
};

/** ข้อมูล metadata ที่เก็บได้จาก Lavalink Track (lavalink.md §6.1 "เราเก็บอะไร") */
export interface TrackUpsert {
  sourceName: string;
  sourceIdentifier: string;
  title: string;
  artist: string;
  album?: string | null;
  /** isStream=true → 0 (database.md §2.2: stream ไม่มีความยาว แต่คอลัมน์ NOT NULL) */
  durationMs: number;
  isStream: boolean;
  isSeekable: boolean;
  artworkUrl?: string | null;
  isrc?: string | null;
  lavalinkEncoded?: string | null;
}

/**
 * dedupe ด้วย UNIQUE(source_name, source_identifier) — search ซ้ำอัปเดต metadata แทนที่จะเพิ่ม row
 * (database.md §4 "Dedupe track ตอน search/Lavalink upsert")
 */
export async function upsertTrack(
  db: Db,
  track: TrackUpsert,
): Promise<{ id: string; isNew: boolean }> {
  const now = new Date();
  const [row] = await db
    .insert(tracks)
    .values({
      sourceName: track.sourceName,
      sourceIdentifier: track.sourceIdentifier,
      title: track.title,
      artist: track.artist,
      album: track.album ?? null,
      durationMs: track.durationMs,
      isStream: track.isStream,
      isSeekable: track.isSeekable,
      artworkUrl: track.artworkUrl ?? null,
      isrc: track.isrc ?? null,
      lavalinkEncoded: track.lavalinkEncoded ?? null,
      resolvedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [tracks.sourceName, tracks.sourceIdentifier],
      set: {
        title: track.title,
        artist: track.artist,
        album: track.album ?? null,
        durationMs: track.durationMs,
        isStream: track.isStream,
        isSeekable: track.isSeekable,
        artworkUrl: track.artworkUrl ?? null,
        isrc: track.isrc ?? null,
        lavalinkEncoded: track.lavalinkEncoded ?? null,
        resolvedAt: now,
        updatedAt: now,
      },
    })
    // xmax = 0 → row นี้เพิ่งถูก insert (ไม่ใช่ update) — ใช้ตัดสินว่าควร enrich genre หรือไม่
    .returning({ id: tracks.id, isNew: sql<boolean>`(xmax = 0)` });
  if (!row) {
    throw new Error(
      `upsertTrack: no row returned for ${track.sourceName}:${track.sourceIdentifier}`,
    );
  }
  return { id: row.id, isNew: Boolean(row.isNew) };
}

/** ตอน stream: หา track จาก trackId */
export async function findTrackById(db: Db, id: string) {
  const [row] = await db
    .select({
      id: tracks.id,
      sourceName: tracks.sourceName,
      sourceIdentifier: tracks.sourceIdentifier,
      isStream: tracks.isStream,
      streamUrl: tracks.streamUrl,
      contentType: tracks.contentType,
    })
    .from(tracks)
    .where(eq(tracks.id, id))
    .limit(1);
  return row;
}

/** persist stream metadata หลัง resolve (database.md §2.2 — ค่านี้ไม่ return ให้ client) */
export async function updateStreamMeta(
  db: Db,
  id: string,
  meta: { streamUrl: string; contentType: string },
): Promise<void> {
  await db
    .update(tracks)
    .set({
      streamUrl: meta.streamUrl,
      contentType: meta.contentType,
      resolvedAt: new Date(),
    })
    .where(eq(tracks.id, id));
}

/**
 * ค้นใน library ที่เคย resolve — pg_trgm (GIN index มีอยู่แล้วใน migration 0000)
 * fuzzy ที่ similarity > 0.3 + substring ILIKE สำหรับคำสั้น ๆ เรียงจากคล้ายสุด
 */
export async function searchTracks(
  db: Db,
  q: string,
  limit: number,
): Promise<TrackDTO[]> {
  const pattern = `%${q.replace(/([%_\\])/g, "\\$1")}%`;
  const rows = await db
    .select(dtoColumns)
    .from(tracks)
    .where(
      sql`(${tracks.title} ILIKE ${pattern} OR ${tracks.artist} ILIKE ${pattern} OR similarity(${tracks.title}, ${q}) > 0.3 OR similarity(${tracks.artist}, ${q}) > 0.3)`,
    )
    .orderBy(
      desc(
        sql`GREATEST(similarity(${tracks.title}, ${q}), similarity(${tracks.artist}, ${q}))`,
      ),
    )
    .limit(limit);
  return rows.map((row) => ({ ...row, isLiked: false }));
}

/** batch fetch (api.md §3 endpoint 8) — คืนตามลำดับ ids ที่ส่งมา, id ที่ไม่มีตัดทิ้ง */
export async function findTrackDTOs(db: Db, ids: string[]): Promise<TrackDTO[]> {
  if (ids.length === 0) return [];
  const rows = await db.select(dtoColumns).from(tracks).where(inArray(tracks.id, ids));
  const byId = new Map(
    rows.map((row) => [row.id, { ...row, isLiked: false } as TrackDTO]),
  );
  return ids.flatMap((id) => {
    const dto = byId.get(id);
    return dto ? [dto] : [];
  });
}

/** เติม genres ของ track (genre enrichment — database.md §2.2) */
export async function updateGenres(
  db: Db,
  id: string,
  genres: string[],
): Promise<void> {
  await db.update(tracks).set({ genres }).where(eq(tracks.id, id));
}
