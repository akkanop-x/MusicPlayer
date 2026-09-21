/**
 * repo ฝั่ง listening history — listening_history (database.md §2.6)
 * timeline query หลักใช้ index (user_id, played_at DESC); cursor = playedAt ISO
 */
import { and, desc, eq, lt } from "drizzle-orm";
import type { HistoryEntryDTO } from "@musicplayer/shared";
import type { Db } from "../db/client.js";
import { listeningHistory, tracks } from "../db/schema.js";
import { trackDtoColumns, toTrackDTO } from "./tracks.repo.js";

export interface HistoryInsert {
  trackId: string;
  msPlayed: number;
  completed: boolean;
  skipped: boolean;
  /** queue | radio | playlist | search | null (database.md §2.6 — nullable) */
  contextType?: string | null;
  contextId?: string | null;
  playedAt?: Date;
}

export async function insertHistoryEntry(
  db: Db,
  userId: string,
  entry: HistoryInsert,
): Promise<void> {
  await db.insert(listeningHistory).values({
    userId,
    trackId: entry.trackId,
    playedAt: entry.playedAt ?? new Date(),
    msPlayed: entry.msPlayed,
    completed: entry.completed,
    skipped: entry.skipped,
    contextType: entry.contextType ?? null,
    contextId: entry.contextId ?? null,
  });
}

/** timeline + cursor pagination (api.md #37) — before = playedAt ISO ของ item สุดท้ายหน้าก่อน */
export async function listHistory(
  db: Db,
  userId: string,
  options: { limit: number; before?: Date | null },
): Promise<HistoryEntryDTO[]> {
  const conditions = [eq(listeningHistory.userId, userId)];
  if (options.before) {
    conditions.push(lt(listeningHistory.playedAt, options.before));
  }
  const rows = await db
    .select({
      entryId: listeningHistory.id,
      playedAt: listeningHistory.playedAt,
      msPlayed: listeningHistory.msPlayed,
      completed: listeningHistory.completed,
      skipped: listeningHistory.skipped,
      ...trackDtoColumns,
    })
    .from(listeningHistory)
    .innerJoin(tracks, eq(listeningHistory.trackId, tracks.id))
    .where(and(...conditions))
    .orderBy(desc(listeningHistory.playedAt))
    .limit(options.limit);
  return rows.map((r) => ({
    id: r.entryId,
    track: toTrackDTO(r, false),
    playedAt: r.playedAt.toISOString(),
    msPlayed: r.msPlayed,
    completed: r.completed,
    skipped: r.skipped,
  }));
}
