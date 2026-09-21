/**
 * Realtime events (Socket.IO) — websocket.md §2–§4
 * event name เดียวกันทั้ง server/web; ทุก server→client event แนบ `version`
 * (monotonic ต่อ user — client ทิ้ง event ที่ version ต่ำกว่าที่ตนถืออยู่ กัน out-of-order)
 */
import type { TrackDTO } from "./types.js";
import type { PlayerState, RepeatMode } from "./playerState.js";

/** Server → Client (websocket.md §3) */
export const RealtimeEvents = {
  PlayerStateChanged: "PLAYER_STATE_CHANGED",
  TrackStarted: "TRACK_STARTED",
  TrackEnded: "TRACK_ENDED",
  TrackException: "TRACK_EXCEPTION",
  QueueUpdated: "QUEUE_UPDATED",
  QueueEnded: "QUEUE_ENDED",
  PositionUpdated: "POSITION_UPDATED",
  VolumeChanged: "VOLUME_CHANGED",
  /** Phase 8 — equalizer.md §5 (active preset เปลี่ยน / preset ที่ active ถูกแก้-ลบ) */
  EqChanged: "EQ_CHANGED",
  /** Phase 10 — websocket.md §3 (PUT/DELETE like จากอุปกรณ์อื่น) */
  LikesChanged: "LIKES_CHANGED",
} as const;

export type RealtimeEventName = (typeof RealtimeEvents)[keyof typeof RealtimeEvents];

/** payload ร่วม: event ที่เกี่ยวกับ state แนบ version เสมอ (websocket.md §2) */
export interface RealtimeEnvelope {
  version: number;
}

export interface PlayerStateChangedPayload extends RealtimeEnvelope {
  state: PlayerState;
  track: TrackDTO | null;
  positionMs: number;
}

export interface TrackStartedPayload extends RealtimeEnvelope {
  item: { id: string; track: TrackDTO };
  positionMs: number;
}

export interface TrackEndedPayload extends RealtimeEnvelope {
  item: { id: string; track: TrackDTO } | null;
  reason: "completed" | "skipped" | "error" | "replaced";
}

export interface TrackExceptionPayload extends RealtimeEnvelope {
  item: { id: string; track: TrackDTO } | null;
  code: "UNPLAYABLE" | "SOURCE_ERROR" | "CODEC_UNSUPPORTED";
  message: string;
}

export interface QueueUpdatedPayload extends RealtimeEnvelope {
  queue: {
    current: { id: string; track: TrackDTO } | null;
    upcoming: Array<{ id: string; track: TrackDTO }>;
    history: Array<{ id: string; track: TrackDTO }>;
    version: number;
  };
}

export type QueueEndedPayload = RealtimeEnvelope;

export interface PositionUpdatedPayload extends RealtimeEnvelope {
  positionMs: number;
}

export interface VolumeChangedPayload extends RealtimeEnvelope {
  volume: number;
  muted: boolean;
}

/** LIKES_CHANGED (websocket.md §3) — hub แนบ version ให้เองเหมือน event อื่น */
export interface EqChangedPayload extends RealtimeEnvelope {
  presetId: string | null;
  bands: number[] | null;
}

export interface LikesChangedPayload {
  trackId: string;
  liked: boolean;
}

/** Client → Server (websocket.md §4) */
export const RealtimeClientEvents = {
  PositionSync: "POSITION_SYNC",
  TrackEndedReport: "TRACK_ENDED",
  TrackStalled: "TRACK_STALLED",
  SyncRequest: "SYNC_REQUEST",
} as const;

export interface PositionSyncAck {
  ok: boolean;
}

export interface TrackEndedAck {
  ok: boolean;
  /** false = trackId ไม่ตรง current (server ข้าม ไม่ advance) */
  ended: boolean;
}

export interface TrackStalledAck {
  ok: boolean;
  /** true = ครบ threshold แล้ว server ข้ามเพลงให้ (TRACK_EXCEPTION ตามมา) */
  exception: boolean;
}

/** volume/repeat settings ที่ client อาจได้จาก state event — RepeatMode ใช้ซ้ำ */
export type RealtimeRepeatMode = RepeatMode;
