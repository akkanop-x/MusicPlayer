import { tracks } from "../db/schema.js";
import type { Db } from "../db/client.js";

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
export async function upsertTrack(db: Db, track: TrackUpsert): Promise<{ id: string }> {
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
    .returning({ id: tracks.id });
  if (!row) {
    throw new Error(
      `upsertTrack: no row returned for ${track.sourceName}:${track.sourceIdentifier}`,
    );
  }
  return row;
}
