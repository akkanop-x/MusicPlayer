/**
 * DTO กลางของระบบ — api.md §1/§3 (frontend และ backend ใช้ shape เดียวกัน)
 * ห้ามใส่ field ฝั่ง infra (stream_url, lavalink_encoded) ใน DTO ฝั่ง client เด็ดขาด
 */
import type { PlayerState, RepeatMode } from "./playerState.js";

export interface TrackDTO {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  isStream: boolean;
  isSeekable: boolean;
  artworkUrl: string | null;
  /** youtube | http | local | … (จาก Lavalink sourceName — Spotify ถูกถอดออก ADR-009) */
  sourceName: string;
  /** เติมตอนผู้ใช้ล็อกอิน (Phase 10) — Phase 2 เป็น false เสมอ */
  isLiked: boolean;
}

export interface SearchResponseDTO {
  tracks: TrackDTO[];
  /** source ที่ใช้ได้ / ที่ตอบไม่ได้ช่วงนี้ (fail-soft — backend.md SearchService) */
  sources: { available: string[]; degraded: string[] };
}

/** api.md §4 — คืนจากทุก /player endpoint เพื่อให้ client ไม่ต้องรอ WS */
export interface PlayerStateDTO {
  state: PlayerState;
  track: TrackDTO | null;
  positionMs: number;
  volume: number;
  muted: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  autoplay: boolean;
}

/** ชิ้นเดียวใน queue — id สุ่มต่อชิ้น (track ซ้ำได้, remove/move by id — queue.md §1) */
export interface QueueItemDTO {
  id: string;
  track: TrackDTO;
}

/** api.md §5 — คืนจากทุก /queue endpoint และ /player/skip|shuffle */
export interface QueueStateDTO {
  current: QueueItemDTO | null;
  upcoming: QueueItemDTO[];
  history: QueueItemDTO[];
  version: number;
}

// ---------- Phase 10: Playlists / Likes / History (api.md §7–§9) ----------

/** api.md §7 — tracks เติมเฉพาะ GET /playlists/:id (list ไม่ hydrate เพลง) */
export interface PlaylistDTO {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  trackCount: number;
  /** ISO 8601 */
  updatedAt: string;
  tracks?: TrackDTO[];
  /** id ของ playlist_tracks — สัมพันธ์ตามลำดับกับ tracks (ใช้ remove/reorder api.md #32/#33) */
  itemIds?: string[];
}

/** api.md §8 #34 — เรียง likedAt ใหม่ → เก่า (database.md §2.5) */
export interface LikeEntryDTO {
  track: TrackDTO;
  /** ISO 8601 */
  likedAt: string;
}

export interface LikesPageDTO {
  items: LikeEntryDTO[];
  /** ISO 8601 ของ item สุดท้าย — ส่งกลับเป็น ?cursor= ครั้งถัดไป; null = หมด */
  nextCursor: string | null;
}

/** api.md §9 #37 — listening_history เรียง playedAt ใหม่ → เก่า (database.md §2.6) */
export interface HistoryEntryDTO {
  id: string;
  track: TrackDTO;
  /** ISO 8601 */
  playedAt: string;
  /** clamp [0, durationMs] (testing.md §3.6: msPlayed ถูก clamp) */
  msPlayed: number;
  completed: boolean;
  /** skip ก่อนจบ — โผล่ใน history พร้อม tag skipped (requirements.md Open Question #1) */
  skipped: boolean;
}

export interface HistoryPageDTO {
  items: HistoryEntryDTO[];
  nextCursor: string | null;
}
