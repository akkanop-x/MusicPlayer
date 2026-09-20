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
