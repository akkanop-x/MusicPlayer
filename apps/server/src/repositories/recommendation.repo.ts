/**
 * recommendation.repo — candidate queries ของ RecommendationProvider
 * (recommendation.md §4: ใช้ tracks/listening_history/liked_tracks ที่มีอยู่ —
 * ยังไม่มีตาราง artists/albums normalized จึงใช้ string equality ของ artist)
 */
import { and, count, desc, notInArray, sql } from "drizzle-orm";
import type { TrackDTO } from "@musicplayer/shared";
import type { Db } from "../db/client.js";
import { listeningHistory, likedTracks, tracks } from "../db/schema.js";
import { toTrackDTO, trackDtoColumns } from "./tracks.repo.js";

/** เพลงศิลปินเดียวกับ seed (case-insensitive) ที่ไม่อยู่ใน exclude */
export async function findSameArtistTracks(
  db: Db,
  artists: string[],
  exclude: string[],
  limit: number,
): Promise<TrackDTO[]> {
  if (artists.length === 0 || limit <= 0) return [];
  const lowered = artists.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (lowered.length === 0) return [];
  const rows = await db
    .select(trackDtoColumns)
    .from(tracks)
    .where(
      and(
        sql`lower(${tracks.artist}) in (${sql.join(
          lowered.map((a) => sql`${a}`),
          sql`, `,
        )})`,
        exclude.length > 0 ? notInArray(tracks.id, exclude) : undefined,
      ),
    )
    .limit(limit);
  return rows.map((row) => toTrackDTO(row, false));
}

/** เพลงที่ user เล่นบ่อยสุดจาก listening_history (signal fallback ของ autoplay) */
export async function findTopPlayedTracks(
  db: Db,
  userId: string,
  exclude: string[],
  limit: number,
): Promise<TrackDTO[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select(trackDtoColumns)
    .from(listeningHistory)
    .innerJoin(tracks, sql`${tracks.id} = ${listeningHistory.trackId}`)
    .where(
      and(
        sql`${listeningHistory.userId} = ${userId}`,
        exclude.length > 0 ? notInArray(listeningHistory.trackId, exclude) : undefined,
      ),
    )
    .groupBy(tracks.id)
    .orderBy(desc(count(listeningHistory.id)))
    .limit(limit);
  return rows.map((row) => toTrackDTO(row, false));
}

/** เพลงที่ user like (ลำดับใหม่สุดก่อน — signal fallback ของ autoplay) */
export async function findLikedTracksForRadio(
  db: Db,
  userId: string,
  exclude: string[],
  limit: number,
): Promise<TrackDTO[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select(trackDtoColumns)
    .from(likedTracks)
    .innerJoin(tracks, sql`${tracks.id} = ${likedTracks.trackId}`)
    .where(
      and(
        sql`${likedTracks.userId} = ${userId}`,
        exclude.length > 0 ? notInArray(likedTracks.trackId, exclude) : undefined,
      ),
    )
    .orderBy(desc(likedTracks.likedAt))
    .limit(limit);
  return rows.map((row) => toTrackDTO(row, false));
}

/**
 * เพลงชื่อคล้ายกัน (token overlap) — signal สุดท้ายก่อนตอบ empty:
 * metadata ศิลปินจาก YouTube คือชื่อผู้อัปโหลด (แต่ละอัปโหลดต่างกัน) แต่เวอร์ชันอื่น
 * ของ "เพลงเดียวกัน" มักมี token ชื่อเพลงร่วมกัน → เจอตัวเลือกที่เกี่ยวข้องจริงแม้
 * same-artist/top played/liked ว่าง (recommendation.md §7 fallback)
 */
export async function findSimilarTitleTracks(
  db: Db,
  titleTokens: string[],
  exclude: string[],
  limit: number,
): Promise<TrackDTO[]> {
  if (limit <= 0) return [];
  const tokens = [...new Set(titleTokens)].filter((t) => t.length >= 4).slice(0, 4);
  if (tokens.length === 0) return [];
  const rows = await db
    .select(trackDtoColumns)
    .from(tracks)
    .where(
      and(
        sql`${sql.join(
          tokens.map((t) => sql`${tracks.title} ilike ${"%".concat(t, "%")}`),
          sql` or `,
        )}`,
        exclude.length > 0 ? notInArray(tracks.id, exclude) : undefined,
      ),
    )
    .limit(limit);
  return rows.map((row) => toTrackDTO(row, false));
}
