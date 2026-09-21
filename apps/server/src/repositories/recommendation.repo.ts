/**
 * recommendation.repo — candidate queries ของ RecommendationProvider
 * (recommendation.md §4: ใช้ tracks/listening_history/liked_tracks ที่มีอยู่ —
 * ยังไม่มีตาราง artists/albums normalized จึงใช้ string equality ของ artist)
 */
import { and, count, desc, eq, gt, max, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { listeningHistory, likedTracks, tracks } from "../db/schema.js";
import { toTrackDTO, trackDtoColumns } from "./tracks.repo.js";
import type { RadioCandidate } from "../services/recommendation/provider.js";

/** TrackDTO + genres — genre constraint/scoring ใช้เฉพาะภายใน recommendation engine */
const candidateColumns = { ...trackDtoColumns, genres: tracks.genres };

function toCandidate(row: {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  isStream: boolean;
  isSeekable: boolean;
  artworkUrl: string | null;
  sourceName: string;
  genres: string[] | null;
}): RadioCandidate {
  return { ...toTrackDTO(row, false), genres: row.genres ?? [] };
}

/**
 * Genre matching normalize ฝั่ง SQL ให้ตรงกับ normalizeGenre ใน ruleBased.ts:
 * lowercase + ตัดทุกตัวอักษรที่ไม่ใช่ [a-z0-9] ("Hip-Hop" = "hip hop" = "hiphop")
 */
const NORM_GENRE_SQL = sql`regexp_replace(lower(g), '[^a-z0-9]', '', 'g')`;

/** เพลงที่มี genre ใดตรงกับรายการ (normalized แล้วจาก caller) — ใช้ GIN tracks_genres_idx */
export async function findSameGenreTracks(
  db: Db,
  genres: string[],
  exclude: string[],
  limit: number,
): Promise<RadioCandidate[]> {
  if (genres.length === 0 || limit <= 0) return [];
  const rows = await db
    .select(candidateColumns)
    .from(tracks)
    .where(
      and(
        sql`exists (select 1 from unnest(${tracks.genres}) as g where ${NORM_GENRE_SQL} in (${sql.join(
          genres.map((g) => sql`${g}`),
          sql`, `,
        )}))`,
        exclude.length > 0 ? notInArray(tracks.id, exclude) : undefined,
      ),
    )
    .limit(limit);
  return rows.map(toCandidate);
}

/** เพลงอัลบั้มเดียวกับ seed (case-insensitive) — candidate +3 ของ §2.1 */
export async function findSameAlbumTracks(
  db: Db,
  albums: string[],
  exclude: string[],
  limit: number,
): Promise<RadioCandidate[]> {
  if (albums.length === 0 || limit <= 0) return [];
  const lowered = albums.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (lowered.length === 0) return [];
  const rows = await db
    .select(candidateColumns)
    .from(tracks)
    .where(
      and(
        sql`lower(${tracks.album}) in (${sql.join(
          lowered.map((a) => sql`${a}`),
          sql`, `,
        )})`,
        exclude.length > 0 ? notInArray(tracks.id, exclude) : undefined,
      ),
    )
    .limit(limit);
  return rows.map(toCandidate);
}

/** เพลงที่ user เพิ่งเล่นในช่วง `since` (7 วันล่าสุด) — candidate +3 ของ §2.1 */
export async function findRecentlyPlayedTracks(
  db: Db,
  userId: string,
  since: Date,
  exclude: string[],
  limit: number,
): Promise<RadioCandidate[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select(candidateColumns)
    .from(listeningHistory)
    .innerJoin(tracks, sql`${tracks.id} = ${listeningHistory.trackId}`)
    .where(
      and(
        sql`${listeningHistory.userId} = ${userId}`,
        gt(listeningHistory.playedAt, since),
        exclude.length > 0 ? notInArray(listeningHistory.trackId, exclude) : undefined,
      ),
    )
    .groupBy(tracks.id)
    .limit(limit);
  return rows.map(toCandidate);
}

/** trackId ที่เล่นล่าสุด N เพลง (distinct, ใหม่สุดก่อน) — filter "recently played" ของ §3 */
export async function findRecentlyPlayedTrackIds(
  db: Db,
  userId: string,
  limit: number,
): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ trackId: listeningHistory.trackId, last: max(listeningHistory.playedAt) })
    .from(listeningHistory)
    .where(sql`${listeningHistory.userId} = ${userId}`)
    .groupBy(listeningHistory.trackId)
    .orderBy(desc(max(listeningHistory.playedAt)))
    .limit(limit);
  return rows.map((r) => r.trackId);
}

/** trackId ที่ user กด skip ล่าสุด N เพลง — filter "skipped" (สัญญาณเชิงลบ) ของ §3 */
export async function findSkippedTrackIds(
  db: Db,
  userId: string,
  limit: number,
): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ trackId: listeningHistory.trackId, last: max(listeningHistory.playedAt) })
    .from(listeningHistory)
    .where(
      and(
        sql`${listeningHistory.userId} = ${userId}`,
        eq(listeningHistory.skipped, true),
      ),
    )
    .groupBy(listeningHistory.trackId)
    .orderBy(desc(max(listeningHistory.playedAt)))
    .limit(limit);
  return rows.map((r) => r.trackId);
}

/**
 * เพลงที่ user เล่นจบล่าสุด N เพลง — แหล่ง genres สำรองเมื่อ seed ไม่มี genre
 * (§2.1.1 fallback: "median ของ user taste")
 */
export async function findLastCompletedTracks(
  db: Db,
  userId: string,
  limit: number,
): Promise<RadioCandidate[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select(candidateColumns)
    .from(listeningHistory)
    .innerJoin(tracks, sql`${tracks.id} = ${listeningHistory.trackId}`)
    .where(
      and(
        sql`${listeningHistory.userId} = ${userId}`,
        eq(listeningHistory.skipped, false),
      ),
    )
    .orderBy(desc(listeningHistory.playedAt))
    .limit(limit);
  return rows.map(toCandidate);
}

/** เพลงศิลปินเดียวกับ seed (case-insensitive) ที่ไม่อยู่ใน exclude */
export async function findSameArtistTracks(
  db: Db,
  artists: string[],
  exclude: string[],
  limit: number,
): Promise<RadioCandidate[]> {
  if (artists.length === 0 || limit <= 0) return [];
  const lowered = artists.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (lowered.length === 0) return [];
  const rows = await db
    .select(candidateColumns)
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
  return rows.map(toCandidate);
}

/** เพลงที่ user เล่นบ่อยสุดจาก listening_history (signal fallback ของ autoplay) */
export async function findTopPlayedTracks(
  db: Db,
  userId: string,
  exclude: string[],
  limit: number,
): Promise<RadioCandidate[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select(candidateColumns)
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
  return rows.map(toCandidate);
}

/** เพลงที่ user like (ลำดับใหม่สุดก่อน — signal fallback ของ autoplay) */
export async function findLikedTracksForRadio(
  db: Db,
  userId: string,
  exclude: string[],
  limit: number,
): Promise<RadioCandidate[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select(candidateColumns)
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
  return rows.map(toCandidate);
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
): Promise<RadioCandidate[]> {
  if (limit <= 0) return [];
  const tokens = [...new Set(titleTokens)].filter((t) => t.length >= 4).slice(0, 4);
  if (tokens.length === 0) return [];
  const rows = await db
    .select(candidateColumns)
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
  return rows.map(toCandidate);
}
