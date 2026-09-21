import { create } from "zustand";
import type { PlayerStateDTO, QueueStateDTO, TrackDTO } from "@musicplayer/shared";

/**
 * mirror ของ server player state (player.md §4) — อัปเดตจาก response ของทุก /player call
 * และจาก media events ของ AudioEngine (client เป็น source of truth ของ position ใน Phase 4 — ไม่มี WS)
 */
interface PlayerStore extends PlayerStateDTO {
  setStateDto: (dto: PlayerStateDTO) => void;
  /** ใช้เมื่อ media event บอกสถานะละเอียดกว่า server (เช่น BUFFERING จริง) — shuffle เป็น optimistic */
  patchState: (
    patch: Partial<Pick<PlayerStateDTO, "state" | "positionMs" | "shuffle">>,
  ) => void;
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  state: "IDLE",
  track: null,
  positionMs: 0,
  volume: 80,
  muted: false,
  repeatMode: "off",
  shuffle: false,
  autoplay: true,
  radio: false,
  setStateDto: (dto) => set(dto),
  patchState: (patch) => set(patch),
}));

/** progress แยก store — progress อัปเดตถี่ (timeupdate 4 ครั้ง/วิ) ตัดสินใจตาม ADR-005 selector */
interface ProgressStore {
  positionMs: number;
  durationMs: number;
  /** ตำแหน่งที่ UI กำลังลาก (ยังไม่ commit) — null = ไม่ได้ลาก */
  scrubMs: number | null;
  setProgress: (positionMs: number, durationMs: number) => void;
  setScrub: (ms: number | null) => void;
}

export const useProgressStore = create<ProgressStore>((set) => ({
  positionMs: 0,
  durationMs: 0,
  scrubMs: null,
  setProgress: (positionMs, durationMs) => set({ positionMs, durationMs }),
  setScrub: (scrubMs) => set({ scrubMs }),
}));

/** toast เล็ก ๆ สำหรับ edge #4 (error ครบ 3 ติด) และ error อื่น ๆ */
interface ToastStore {
  message: string | null;
  show: (message: string) => void;
  hide: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  message: null,
  show: (message) => set({ message }),
  hide: () => set({ message: null }),
}));

/** เก็บ track ที่กำลัง "จะเล่น" — ใช้แสดงใน PlayerBar ระหว่าง LOADING ก่อน DTO กลับมา */
interface IntentStore {
  pendingTrack: TrackDTO | null;
  setPendingTrack: (track: TrackDTO | null) => void;
}

export const useIntentStore = create<IntentStore>((set) => ({
  pendingTrack: null,
  setPendingTrack: (pendingTrack) => set({ pendingTrack }),
}));

/** mirror ของ server queue (queue.md) — อัปเดตจาก response ของทุก /queue และ /player คำสั่ง */
interface QueueStore extends QueueStateDTO {
  setQueueDto: (dto: QueueStateDTO) => void;
}

export const useQueueStore = create<QueueStore>((set) => ({
  current: null,
  upcoming: [],
  history: [],
  version: 0,
  setQueueDto: (dto) => set(dto),
}));

/** UI state — frontend.md §3.6 (ไม่ sync backend) */
interface UiStore {
  isNowPlayingOpen: boolean;
  setNowPlayingOpen: (open: boolean) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  isNowPlayingOpen: false,
  setNowPlayingOpen: (isNowPlayingOpen) => set({ isNowPlayingOpen }),
}));
