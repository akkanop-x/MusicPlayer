/**
 * DTO กลางของระบบ — api.md §1/§3 (frontend และ backend ใช้ shape เดียวกัน)
 * ห้ามใส่ field ฝั่ง infra (stream_url, lavalink_encoded) ใน DTO ฝั่ง client เด็ดขาด
 */

export interface TrackDTO {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  isStream: boolean;
  isSeekable: boolean;
  artworkUrl: string | null;
  /** youtube | spotify | http | local | … (จาก Lavalink sourceName) */
  sourceName: string;
  /** เติมตอนผู้ใช้ล็อกอิน (Phase 10) — Phase 2 เป็น false เสมอ */
  isLiked: boolean;
}

export interface SearchResponseDTO {
  tracks: TrackDTO[];
  /** source ที่ใช้ได้ / ที่ตอบไม่ได้ช่วงนี้ (fail-soft — backend.md SearchService) */
  sources: { available: string[]; degraded: string[] };
}
