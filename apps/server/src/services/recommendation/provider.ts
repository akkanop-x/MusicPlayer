/**
 * RecommendationProvider — recommendation.md §1
 * Phase 12: getRadioTracks เต็มรูป (candidate pool + genre constraint §2.1.1 + scoring §2.2)
 * และเพิ่ม getHomeFeed สำหรับ "แนะนำสำหรับคุณ"; สลับ impl ผ่าน DI ได้
 */
import type { TrackDTO } from "@musicplayer/shared";

export interface RadioSeed {
  /** เพลง seed (autoplay = เพลงที่เพิ่งจบ, radio = เพลงตั้งต้น) */
  trackId?: string;
  /** ผู้ใช้ — ใช้เป็น fallback signal (frequently played / liked) เมื่อ same artist ไม่พอ */
  userId?: string;
  /**
   * §6 adaptive — ศิลปินที่เพลงเล่นจบ (ไม่ skip) ใน radio นี้ → +2 ในการ extend ถัดไป
   * (PlayerService จดจาก reportTrackEnded แล้วส่งกลับเข้ามา)
   */
  boostArtists?: string[];
}

/** candidate ภายในของ provider — genres ไม่ได้อยู่ใน TrackDTO (ใช้เฉพาะฝั่ง engine) */
export type RadioCandidate = TrackDTO & { genres: string[] };

export interface RecommendationProvider {
  /** หน้า home: "แนะนำสำหรับคุณ" — user ไม่มี like/history เลย → คืน [] (§7) */
  getHomeFeed(userId: string, limit: number): Promise<TrackDTO[]>;
  /** autoplay + radio: ต่อเนื่องจาก seed, ห้ามซ้ำกับ exclude */
  getRadioTracks(
    seed: RadioSeed,
    exclude: Set<string>,
    limit: number,
  ): Promise<TrackDTO[]>;
}
