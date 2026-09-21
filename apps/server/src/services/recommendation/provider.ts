/**
 * RecommendationProvider — recommendation.md §1
 * Phase 11 ใช้เฉพาะ getRadioTracks (autoplay refill/prefetch); getHomeFeed และ scoring
 * เต็ม (candidate pool, genre constraint §2.1.1) เป็น Phase 12 — สลับ impl ผ่าน DI ได้
 */
import type { TrackDTO } from "@musicplayer/shared";

export interface RadioSeed {
  /** เพลง seed (autoplay = เพลงที่เพิ่งจบ, radio = เพลงตั้งต้น) */
  trackId?: string;
  /** ผู้ใช้ — ใช้เป็น fallback signal (frequently played / liked) เมื่อ same artist ไม่พอ */
  userId?: string;
}

export interface RecommendationProvider {
  /** คืนเพลงที่ "เล่นได้" (มีใน tracks table) และไม่อยู่ใน exclude เสมอ */
  getRadioTracks(
    seed: RadioSeed,
    exclude: Set<string>,
    limit: number,
  ): Promise<TrackDTO[]>;
}
