/**
 * handlers — websocket.md §2/§3: dispatch server→client events เข้า stores/AudioEngine
 * version gate: ทุก event แนบ version (monotonic ต่อ user) — ทิ้ง event ที่เก่ากว่าที่เคยเห็น
 * กัน out-of-order เมื่อ sync (TRACK_STARTED มาก่อน QUEUE_UPDATED ฯลฯ)
 */
import {
  RealtimeEvents,
  type PlayerStateChangedPayload,
  type PositionUpdatedPayload,
  type QueueStateDTO,
  type TrackExceptionPayload,
  type TrackStartedPayload,
  type VolumeChangedPayload,
} from "@musicplayer/shared";
import { getAudioEngine } from "../lib/audioEngine";
import { usePlayerStore, useQueueStore, useToastStore } from "../stores/playerStore";

let lastVersion = 0;

export function handleRealtimeEvent(
  event: string,
  payload: Record<string, unknown>,
): void {
  const version = typeof payload.version === "number" ? payload.version : 0;
  if (version > 0) {
    if (version <= lastVersion) return; // event เก่า — ทิ้ง
    lastVersion = version;
  }

  const engine = getAudioEngine();
  switch (event) {
    case RealtimeEvents.PlayerStateChanged:
      engine.applyRemotePlayerState(payload as unknown as PlayerStateChangedPayload);
      break;
    case RealtimeEvents.TrackStarted:
      engine.applyTrackStarted(payload as unknown as TrackStartedPayload);
      break;
    case RealtimeEvents.QueueUpdated:
      useQueueStore.getState().setQueueDto(payload.queue as unknown as QueueStateDTO);
      break;
    case RealtimeEvents.PositionUpdated:
      engine.applyRemotePosition(
        (payload as unknown as PositionUpdatedPayload).positionMs,
      );
      break;
    case RealtimeEvents.VolumeChanged: {
      const v = payload as unknown as VolumeChangedPayload;
      engine.applyRemoteVolume(v.volume, v.muted);
      break;
    }
    case RealtimeEvents.TrackException: {
      const ex = payload as unknown as TrackExceptionPayload;
      useToastStore
        .getState()
        .show(ex.message || "เล่นเพลงนี้ไม่ได้ — ข้ามไปเพลงถัดไป");
      break;
    }
    case RealtimeEvents.QueueEnded:
      usePlayerStore.getState().patchState({ state: "IDLE" });
      break;
    // TRACK_ENDED: server advance แล้ว — TRACK_STARTED/QUEUE_UPDATED ตามมาเอง
  }
}

/** test-only — ล้าง version gate */
export function _resetRealtimeForTests(): void {
  lastVersion = 0;
}
