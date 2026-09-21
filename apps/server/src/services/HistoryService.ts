/**
 * HistoryService — api.md §9 (endpoint 37) + queue.md §9 (listening_history เขียนโดย
 * backend จาก playback events ไม่มี POST /history)
 * PlayerService เรียก record() ผ่าน dep callback ตอนเพลงจบ ("completed") หรือถูกแทน/skip
 * ("skip") — msPlayed clamp [0, duration] (testing.md §3.6: เกณฑ์ 30 s ใช้ตอน recommendation)
 */
import type { HistoryEntryDTO, HistoryPageDTO, TrackDTO } from "@musicplayer/shared";
import { LibraryError } from "./LibraryError.js";

export interface HistoryRepos {
  insertHistoryEntry(
    userId: string,
    entry: {
      trackId: string;
      msPlayed: number;
      completed: boolean;
      skipped: boolean;
    },
  ): Promise<void>;
  listHistory(
    userId: string,
    options: { limit: number; before?: Date | null },
  ): Promise<HistoryEntryDTO[]>;
}

export type PlaybackEndReason = "completed" | "skip";

export interface HistoryService {
  list(
    userId: string,
    query: { limit?: number; before?: string },
  ): Promise<HistoryPageDTO>;
  record(
    userId: string,
    input: { track: TrackDTO; positionMs: number; reason: PlaybackEndReason },
  ): Promise<void>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function createHistoryService(repos: HistoryRepos): HistoryService {
  return {
    async list(userId, query) {
      const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
      let before: Date | null = null;
      if (query.before) {
        const parsed = new Date(query.before);
        if (Number.isNaN(parsed.getTime())) {
          throw new LibraryError("VALIDATION_ERROR", "before must be an ISO date");
        }
        before = parsed;
      }
      const items = await repos.listHistory(userId, { limit, before });
      const nextCursor =
        items.length === limit ? (items[items.length - 1]?.playedAt ?? null) : null;
      return { items, nextCursor };
    },

    async record(userId, { track, positionMs, reason }) {
      const duration = track.durationMs > 0 ? track.durationMs : 0;
      const msPlayed = Math.min(Math.max(0, Math.floor(positionMs)), duration);
      await repos
        .insertHistoryEntry(userId, {
          trackId: track.id,
          msPlayed,
          completed: reason === "completed",
          skipped: reason === "skip",
        })
        .catch(() => undefined); // fail-soft — history พังต้องไม่กระทบ playback
    },
  };
}
