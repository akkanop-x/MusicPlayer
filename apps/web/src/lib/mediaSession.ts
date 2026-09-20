/**
 * Media Session API — frontend.md §8.1 (grilling 2026-09-20): ปุ่มหูฟัง/lockscreen +
 * artwork บน lockscreen — ผูก action handlers เข้า AudioEngine เดิม (ไม่มี command path ใหม่)
 * feature-detect: ไม่มี navigator.mediaSession → ทุกอย่าง no-op
 */
import type { PlayerState, TrackDTO } from "@musicplayer/shared";
import { getAudioEngine } from "./audioEngine";
import { useProgressStore } from "../stores/playerStore";

export interface MediaSessionLike {
  metadata: MediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler(action: string, handler: ((details?: unknown) => void) | null): void;
  setPositionState(state: {
    duration?: number;
    playbackRate?: number;
    position?: number;
  }): void;
}

let session: MediaSessionLike | null | undefined;

/** inject ได้เพื่อ test (ปกติคือ navigator.mediaSession หรือ null ถ้าไม่รองรับ) */
function getMediaSession(): MediaSessionLike | null {
  if (session !== undefined) return session;
  const ms = (navigator as Navigator & { mediaSession?: unknown }).mediaSession;
  session = (ms as MediaSessionLike | undefined) ?? null;
  return session;
}

export function _setMediaSessionForTests(value: MediaSessionLike | null): void {
  session = value;
}

/** เรียกครั้งเดียวตอน App mount — ลงทะเบียน action handlers + position จาก progress store */
export function initMediaSession(): void {
  const ms = getMediaSession();
  if (!ms) return;
  const engine = getAudioEngine();
  const set = (action: string, handler: ((details?: unknown) => void) | null) => {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      // browser ไม่รองรับ action นี้ — ข้าม
    }
  };
  set("play", () => {
    engine.ensureAudioGraph();
    void engine.resume();
  });
  set("pause", () => void engine.pause());
  set("previoustrack", () => void engine.previous());
  set("nexttrack", () => void engine.skip());
  set("seekto", (details) => {
    const seekTime = (details as { seekTime?: number } | undefined)?.seekTime;
    if (typeof seekTime === "number" && Number.isFinite(seekTime)) {
      void engine.seek(Math.round(seekTime * 1000));
    }
  });
  set(
    "seekbackward",
    () =>
      void engine.seek(Math.max(0, useProgressStore.getState().positionMs - 10_000)),
  );
  set(
    "seekforward",
    () => void engine.seek(useProgressStore.getState().positionMs + 10_000),
  );
  // positionState — progress store อัปเดตราย timeupdate (อยู่แล้ว) ดึงมาแค่นี้ ไม่แตะ audioEngine กลับ
  useProgressStore.subscribe(({ positionMs, durationMs }) => {
    updateMediaSessionPosition(positionMs, durationMs);
  });
}

/** track เปลี่ยน (TRACK_STARTED / local play) — ชื่อ/ศิลปิน/ปกบน lockscreen */
export function updateMediaSessionMetadata(track: TrackDTO | null): void {
  const ms = getMediaSession();
  if (!ms) return;
  if (!track) {
    ms.metadata = null;
    return;
  }
  try {
    ms.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album ?? "",
      artwork: track.artworkUrl
        ? [{ src: track.artworkUrl, sizes: "640x640", type: "image/jpeg" }]
        : [],
    });
  } catch {
    // MediaMetadata constructor ไม่พร้อมใช้ — ข้าม
  }
}

/** state mirror (websocket.md §3 player state) — lockscreen icon */
export function updateMediaSessionPlaybackState(state: PlayerState): void {
  const ms = getMediaSession();
  if (!ms) return;
  ms.playbackState =
    state === "PLAYING" || state === "BUFFERING" ? "playing" : "paused";
}

/** position ราย timeupdate (throttle ที่ caller) — progress bar บน lockscreen */
export function updateMediaSessionPosition(
  positionMs: number,
  durationMs: number,
): void {
  const ms = getMediaSession();
  if (!ms || typeof ms.setPositionState !== "function") return;
  try {
    ms.setPositionState({
      duration: durationMs / 1000,
      position: Math.min(positionMs, durationMs) / 1000,
      playbackRate: 1,
    });
  } catch {
    // position นอกช่วง duration ชั่วขณะ (ก่อน loadedmetadata) — ข้าม
  }
}
