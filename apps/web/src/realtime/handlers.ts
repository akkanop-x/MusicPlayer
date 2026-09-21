/**
 * handlers — websocket.md §2/§3: dispatch server→client events เข้า stores/AudioEngine
 * version gate: ทุก event แนบ version (monotonic ต่อ user) — ทิ้ง event ที่เก่ากว่าที่เคยเห็น
 * กัน out-of-order เมื่อ sync (TRACK_STARTED มาก่อน QUEUE_UPDATED ฯลฯ)
 */
import {
  RealtimeEvents,
  type EqChangedPayload,
  type LikesChangedPayload,
  type PlayerStateChangedPayload,
  type PositionUpdatedPayload,
  type QueueStateDTO,
  type TrackExceptionPayload,
  type TrackStartedPayload,
  type VolumeChangedPayload,
} from "@musicplayer/shared";
import { getAudioEngine } from "../lib/audioEngine";
import i18next from "../i18n";
import { usePlayerStore, useQueueStore, useToastStore } from "../stores/playerStore";
import { useEqStore } from "../stores/eqStore";
import { queryClient } from "../lib/queryClient";
import { applyLikesChanged } from "../hooks/useLibrary";

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
      useToastStore.getState().show(ex.message || i18next.t("toast:unplayable"));
      break;
    }
    case RealtimeEvents.QueueEnded:
      usePlayerStore.getState().patchState({ state: "IDLE" });
      break;
    case RealtimeEvents.EqChanged: {
      // equalizer.md §5 — อีก tab/อุปกรณ์เปลี่ยน active preset → apply ตาม
      const eq = payload as unknown as EqChangedPayload;
      useEqStore.getState().setActive(eq.presetId, eq.bands);
      useEqStore.getState().setDraft(null);
      engine.applyEq(eq.bands);
      break;
    }
    case RealtimeEvents.LikesChanged: {
      // websocket.md §3 — like/unlike จากอุปกรณ์อื่น → sync hearts + likes cache
      const like = payload as unknown as LikesChangedPayload;
      applyLikesChanged(queryClient, like.trackId, like.liked);
      break;
    }
    // TRACK_ENDED: server advance แล้ว — TRACK_STARTED/QUEUE_UPDATED ตามมาเอง
  }
}

/** test-only — ล้าง version gate */
export function _resetRealtimeForTests(): void {
  lastVersion = 0;
}
