/**
 * LikeService — api.md §8 (endpoint 34–36) + websocket.md §3 LIKES_CHANGED
 * PUT/DELETE idempotent (api.md: click ซ้ำไม่สร้างสถานะเพี้ยน); ทุกความเปลี่ยนแปลง
 * broadcast LIKES_CHANGED { trackId, liked } ไปทุก connection ของ user (RealtimeHub แนบ version)
 */
import type { LikesPageDTO, TrackDTO } from "@musicplayer/shared";
import type { Broadcaster } from "../realtime/RealtimeHub.js";
import { RealtimeEvents } from "@musicplayer/shared";
import { LibraryError } from "./LibraryError.js";

export interface LikeRepos {
  likeTrackRow(
    userId: string,
    trackId: string,
  ): Promise<{ likedAt: Date; alreadyLiked: boolean }>;
  unlikeTrackRow(userId: string, trackId: string): Promise<boolean>;
  listLikedTracks(
    userId: string,
    options: { limit: number; cursor?: Date | null },
  ): Promise<{ track: TrackDTO; likedAt: string }[]>;
  likedTrackIds(userId: string, trackIds: string[]): Promise<Set<string>>;
  trackExists(trackId: string): Promise<boolean>;
}

export interface LikeService {
  list(
    userId: string,
    query: { limit?: number; cursor?: string },
  ): Promise<LikesPageDTO>;
  like(userId: string, trackId: string): Promise<{ trackId: string; liked: true }>;
  unlike(userId: string, trackId: string): Promise<{ trackId: string; liked: false }>;
  /** เติม isLiked ให้ TrackDTO ชุด (search/tracks/playlist — database.md: isLiked เติมตอนล็อกอิน) */
  decorateTracks(userId: string, tracks: TrackDTO[]): Promise<TrackDTO[]>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function createLikeService(
  repos: LikeRepos,
  broadcaster?: Broadcaster,
): LikeService {
  return {
    async list(userId, query) {
      const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
      let cursor: Date | null = null;
      if (query.cursor) {
        const parsed = new Date(query.cursor);
        if (Number.isNaN(parsed.getTime())) {
          throw new LibraryError("VALIDATION_ERROR", "cursor must be an ISO date");
        }
        cursor = parsed;
      }
      const items = await repos.listLikedTracks(userId, { limit, cursor });
      const nextCursor =
        items.length === limit ? (items[items.length - 1]?.likedAt ?? null) : null;
      return { items, nextCursor };
    },

    async like(userId, trackId) {
      if (!(await repos.trackExists(trackId))) {
        throw new LibraryError("TRACK_NOT_FOUND", "track not found");
      }
      const { alreadyLiked } = await repos.likeTrackRow(userId, trackId);
      if (!alreadyLiked) {
        broadcaster?.emitToUser(userId, RealtimeEvents.LikesChanged, {
          trackId,
          liked: true,
        });
      }
      return { trackId, liked: true };
    },

    async unlike(userId, trackId) {
      if (!(await repos.trackExists(trackId))) {
        throw new LibraryError("TRACK_NOT_FOUND", "track not found");
      }
      const removed = await repos.unlikeTrackRow(userId, trackId);
      if (removed) {
        broadcaster?.emitToUser(userId, RealtimeEvents.LikesChanged, {
          trackId,
          liked: false,
        });
      }
      return { trackId, liked: false };
    },

    async decorateTracks(userId, tracks) {
      if (tracks.length === 0) return tracks;
      const liked = await repos.likedTrackIds(
        userId,
        tracks.map((track) => track.id),
      );
      return tracks.map((track) => ({
        ...track,
        isLiked: liked.has(track.id),
      }));
    },
  };
}
