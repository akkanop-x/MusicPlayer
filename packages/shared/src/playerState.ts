/**
 * Player state machine — player.md §1–§3 (pure functions ไม่พึ่ง DOM/network)
 * ทั้ง server (PlayerService) และ client (AudioEngine) ใช้ transition ชุดเดียวกัน
 * เพื่อให้ state ไม่ diverge เกิน ≤ 1 s (player.md §4)
 */

export const PLAYER_STATES = [
  "IDLE",
  "LOADING",
  "PLAYING",
  "PAUSED",
  "BUFFERING",
  "ENDED",
  "ERROR",
] as const;

export type PlayerState = (typeof PLAYER_STATES)[number];

export const REPEAT_MODES = ["off", "one", "all"] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];

/** จำนวนครั้งสูงสุดที่ auto-advance ต่อเนื่องเมื่อ track error (player.md §5 #4) */
export const MAX_CONSECUTIVE_ERRORS = 3;

export interface PlayerContext {
  state: PlayerState;
  /** track ที่กำลังเล่น/โหลด (null = IDLE) */
  trackId: string | null;
  /** มิลลิวินาทีล่าสุดที่รู้ (client ฉีดจาก audio element; server จาก last sync) */
  positionMs: number;
  /** duration ของ track ปัจจุบัน (null = ยังไม่รู้) */
  durationMs: number | null;
  /** intent ที่ค้างจากคำสั่งระหว่าง LOADING — player.md §5 #3 */
  pauseWhenReady: boolean;
  /** นับ track error ติดกัน (รีเซ็ตเมื่อเล่นได้) — player.md §5 #4 */
  consecutiveErrors: number;
}

/** event ที่ state machine รับ — ทั้งจากคำสั่งผู้ใช้และ media element */
export type PlayerEvent =
  | { type: "LOAD"; trackId: string }
  | { type: "CANPLAY"; durationMs: number }
  | { type: "PLAYING" }
  | { type: "PAUSE"; positionMs: number }
  | { type: "WAITING"; positionMs: number }
  | { type: "SEEK"; positionMs: number }
  | { type: "SEEKED"; positionMs: number }
  | { type: "ENDED" }
  | { type: "ERROR"; positionMs?: number }
  | { type: "STOP" };

/** สร้าง context เริ่มต้น (IDLE) */
export function initialPlayerContext(): PlayerContext {
  return {
    state: "IDLE",
    trackId: null,
    positionMs: 0,
    durationMs: null,
    pauseWhenReady: false,
    consecutiveErrors: 0,
  };
}

/**
 * transition เดียวสำหรับทุก event — คืน context ใหม่เสมอ (immutable)
 * กติกาหลัก (player.md §2):
 * - LOAD จาก state ใดก็ได้ → LOADING (track เดิมกำลังเล่น = restart เชิง logic ฝั่ง caller เริ่มที่ 0)
 * - LOADING + CANPLAY → PLAYING หรือ PAUSED ทันทีถ้ามี pauseWhenReady (#3)
 * - PLAYING↔PAUSED, PLAYING↔BUFFERING (WAITING), seek → BUFFERING ชั่วคราว
 * - ENDED → IDLE (การ advance ไป track ถัดไปเป็นหน้าที่ caller สั่ง LOAD ใหม่)
 * - ERROR จาก PLAYING/LOADING/BUFFERING → ERROR + consecutiveErrors+1 (#4)
 * - STOP → IDLE รีเซ็ตทุกอย่าง
 */
export function transition(ctx: PlayerContext, event: PlayerEvent): PlayerContext {
  switch (event.type) {
    case "LOAD":
      return {
        ...ctx,
        state: "LOADING",
        trackId: event.trackId,
        positionMs: 0,
        durationMs: null,
        pauseWhenReady: false,
        // คง consecutiveErrors ไว้ (auto-advance นับข้าม track) — CANPLAY ค่อยรีเซ็ต
      };
    case "CANPLAY":
      if (ctx.state !== "LOADING" && ctx.state !== "BUFFERING") return ctx;
      return {
        ...ctx,
        state: ctx.pauseWhenReady ? "PAUSED" : "PLAYING",
        pauseWhenReady: false,
        durationMs: event.durationMs,
        consecutiveErrors: 0,
      };
    case "PLAYING":
      if (ctx.state === "PLAYING") return ctx;
      if (
        ctx.state !== "LOADING" &&
        ctx.state !== "BUFFERING" &&
        ctx.state !== "PAUSED"
      ) {
        return ctx;
      }
      return { ...ctx, state: "PLAYING", pauseWhenReady: false };
    case "PAUSE":
      if (ctx.state === "LOADING") {
        // #3 — intent ค้างไว้ จะได้ PAUSED ตอน canplay
        return { ...ctx, pauseWhenReady: true };
      }
      if (ctx.state !== "PLAYING" && ctx.state !== "BUFFERING") return ctx;
      return { ...ctx, state: "PAUSED", positionMs: event.positionMs };
    case "WAITING":
      if (ctx.state !== "PLAYING") return ctx;
      return { ...ctx, state: "BUFFERING", positionMs: event.positionMs };
    case "SEEK":
      // player.md §3: seek ระหว่างเล่น → BUFFERING ชั่วคราว; บน IDLE/ENDED ไม่ทำ
      if (
        ctx.state !== "PLAYING" &&
        ctx.state !== "PAUSED" &&
        ctx.state !== "BUFFERING"
      ) {
        return ctx;
      }
      return {
        ...ctx,
        state: "BUFFERING",
        positionMs: clampSeek(ctx, event.positionMs),
      };
    case "SEEKED":
      if (ctx.state !== "BUFFERING") return ctx;
      return { ...ctx, state: "PLAYING", positionMs: event.positionMs };
    case "ENDED":
      if (
        ctx.state !== "PLAYING" &&
        ctx.state !== "BUFFERING" &&
        ctx.state !== "PAUSED"
      ) {
        return ctx;
      }
      return { ...ctx, state: "ENDED", positionMs: ctx.durationMs ?? ctx.positionMs };
    case "ERROR":
      if (ctx.state === "IDLE") return ctx;
      return {
        ...ctx,
        state: "ERROR",
        positionMs: event.positionMs ?? ctx.positionMs,
        consecutiveErrors: ctx.consecutiveErrors + 1,
      };
    case "STOP":
      return initialPlayerContext();
  }
}

/**
 * clamp ตำแหน่ง seek — player.md §3 (clamp [0, duration-1])
 * caller ต้อง reject isStream ก่อนเรียก (state machine ไม่รู้จัก track metadata)
 */
export function clampSeek(ctx: PlayerContext, positionMs: number): number {
  const max = ctx.durationMs === null ? Number.MAX_SAFE_INTEGER : ctx.durationMs - 1;
  return Math.min(Math.max(Math.round(positionMs), 0), Math.max(max, 0));
}

/**
 * ตัดสินว่า ERROR ครั้งนี้ควร auto-advance ต่อหรือไม่ — player.md §5 #4
 * (error ติดกันครบ MAX_CONSECUTIVE_ERRORS → ผู้เรียกต้อง STOP + toast)
 */
export function shouldAutoAdvance(ctx: PlayerContext): boolean {
  return ctx.state === "ERROR" && ctx.consecutiveErrors < MAX_CONSECUTIVE_ERRORS;
}
