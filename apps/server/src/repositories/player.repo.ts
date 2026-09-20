/**
 * repo ฝั่ง player — TrackDTO สำหรับ player + user_settings (volume/repeat)
 * isLiked เติมตอน Phase 10 (likes) — ตอนนี้ false เสมอ
 */
import { eq } from "drizzle-orm";
import type { RepeatMode, TrackDTO } from "@musicplayer/shared";
import type { Db } from "../db/client.js";
import { tracks, userSettings } from "../db/schema.js";

export async function findTrackDTO(db: Db, id: string): Promise<TrackDTO | null> {
  const [row] = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      album: tracks.album,
      durationMs: tracks.durationMs,
      isStream: tracks.isStream,
      isSeekable: tracks.isSeekable,
      artworkUrl: tracks.artworkUrl,
      sourceName: tracks.sourceName,
    })
    .from(tracks)
    .where(eq(tracks.id, id))
    .limit(1);
  return row ? { ...row, isLiked: false } : null;
}

export async function getUserSettings(
  db: Db,
  userId: string,
): Promise<{
  volume: number;
  muted: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  autoplay: boolean;
}> {
  const [row] = await db
    .select({
      volume: userSettings.volume,
      muted: userSettings.muted,
      repeatMode: userSettings.repeatMode,
      shuffle: userSettings.shuffle,
      autoplay: userSettings.autoplay,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (!row) {
    // default ตาม schema — แถวถูกสร้างตอน upsert ครั้งแรก
    return {
      volume: 80,
      muted: false,
      repeatMode: "off",
      shuffle: false,
      autoplay: true,
    };
  }
  return { ...row, repeatMode: row.repeatMode as RepeatMode };
}

export async function saveUserSettings(
  db: Db,
  userId: string,
  patch: { volume?: number; repeatMode?: RepeatMode },
): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, ...patch })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...patch, updatedAt: new Date() },
    });
}
