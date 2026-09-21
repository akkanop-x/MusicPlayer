/**
 * RuleBasedProvider — minimal impl ของ RecommendationProvider (Phase 11)
 * ลำดับ candidate: same artist → top played → liked → similar title (token overlap)
 * (recommendation.md §7 fallback: user ใหม่/seed ไม่มีสัญญาณ → ใช้สิ่งที่มีจริง;
 * artist จาก YouTube คือชื่อผู้อัปโหลด เวอร์ชันเพลงเดียวกันจึงหาได้จากชื่อเพลง)
 * scoring เต็ม + genre constraint = Phase 12 — interface นี้ไม่เปลี่ยน
 */
import type { TrackDTO } from "@musicplayer/shared";
import type { Db } from "../../db/client.js";
import {
  findLikedTracksForRadio,
  findSameArtistTracks,
  findSimilarTitleTracks,
  findTopPlayedTracks,
} from "../../repositories/recommendation.repo.js";
import { findTrackDTOs } from "../../repositories/tracks.repo.js";
import type { RecommendationProvider } from "./provider.js";

/** DI เพื่อ unit test — ใน app ผูก repo จริง */
export interface ProviderQueries {
  findSeedTracks(ids: string[]): Promise<TrackDTO[]>;
  findSameArtistTracks(
    artists: string[],
    exclude: string[],
    limit: number,
  ): Promise<TrackDTO[]>;
  findTopPlayedTracks(
    userId: string,
    exclude: string[],
    limit: number,
  ): Promise<TrackDTO[]>;
  findLikedTracks(
    userId: string,
    exclude: string[],
    limit: number,
  ): Promise<TrackDTO[]>;
  findSimilarTitleTracks(
    titleTokens: string[],
    exclude: string[],
    limit: number,
  ): Promise<TrackDTO[]>;
}

export function realProviderQueries(db: Db): ProviderQueries {
  return {
    findSeedTracks: (ids) => findTrackDTOs(db, ids),
    findSameArtistTracks: (artists, exclude, limit) =>
      findSameArtistTracks(db, artists, exclude, limit),
    findTopPlayedTracks: (userId, exclude, limit) =>
      findTopPlayedTracks(db, userId, exclude, limit),
    findLikedTracks: (userId, exclude, limit) =>
      findLikedTracksForRadio(db, userId, exclude, limit),
    findSimilarTitleTracks: (tokens, exclude, limit) =>
      findSimilarTitleTracks(db, tokens, exclude, limit),
  };
}

function dedupe(tracks: TrackDTO[], taken: Set<string>): TrackDTO[] {
  return tracks.filter((t) => !taken.has(t.id));
}

/** token ยาว ≥ 4 ตัวอักษรจากชื่อเพลง (ตัด short/stopword-ish อย่าง "hq", "one") */
export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4)
    .slice(0, 6);
}

export function createRuleBasedProvider(
  queries: ProviderQueries,
): RecommendationProvider {
  return {
    async getRadioTracks(seed, exclude, limit) {
      if (!seed.trackId || limit <= 0) return [];
      const [seedTrack] = await queries.findSeedTracks([seed.trackId]);
      if (!seedTrack) return [];

      const picked: TrackDTO[] = [];
      const taken = new Set<string>(exclude);
      taken.add(seedTrack.id);
      const push = (tracks: TrackDTO[]) => {
        for (const t of dedupe(tracks, taken)) {
          if (picked.length >= limit) return;
          picked.push(t);
          taken.add(t.id);
        }
      };

      push(
        await queries.findSameArtistTracks(
          [seedTrack.artist],
          [...taken],
          limit - picked.length,
        ),
      );
      if (seed.userId) {
        push(
          await queries.findTopPlayedTracks(
            seed.userId,
            [...taken],
            limit - picked.length,
          ),
        );
        push(
          await queries.findLikedTracks(seed.userId, [...taken], limit - picked.length),
        );
      }
      if (picked.length < limit) {
        push(
          await queries.findSimilarTitleTracks(
            titleTokens(seedTrack.title),
            [...taken],
            limit - picked.length,
          ),
        );
      }
      return picked;
    },
  };
}
