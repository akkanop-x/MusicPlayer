import { describe, expect, it } from "vitest";
import {
  clampSeek,
  initialPlayerContext,
  MAX_CONSECUTIVE_ERRORS,
  shouldAutoAdvance,
  transition,
  type PlayerContext,
} from "./playerState.js";

/** helper: สร้าง context ที่ "กำลังเล่น" อยู่ (LOAD → CANPLAY) */
function playing(overrides?: Partial<PlayerContext>): PlayerContext {
  return {
    ...initialPlayerContext(),
    ...transition(transition(initialPlayerContext(), { type: "LOAD", trackId: "t1" }), {
      type: "CANPLAY",
      durationMs: 213_000,
    }),
    ...overrides,
  };
}

describe("playerState transition", () => {
  it("initial → IDLE ทุก field เป็นค่าเริ่มต้น", () => {
    const ctx = initialPlayerContext();
    expect(ctx).toEqual({
      state: "IDLE",
      trackId: null,
      positionMs: 0,
      durationMs: null,
      pauseWhenReady: false,
      consecutiveErrors: 0,
    });
  });

  it("LOAD จาก IDLE → LOADING (track ใหม่, position รีเซ็ต)", () => {
    const next = transition(initialPlayerContext(), { type: "LOAD", trackId: "a1" });
    expect(next.state).toBe("LOADING");
    expect(next.trackId).toBe("a1");
    expect(next.positionMs).toBe(0);
    expect(next.durationMs).toBeNull();
  });

  it("LOAD จาก PLAYING → LOADING (skip/เล่นเพลงใหม่กลางคัน)", () => {
    const next = transition(playing(), { type: "LOAD", trackId: "a2" });
    expect(next.state).toBe("LOADING");
    expect(next.trackId).toBe("a2");
    expect(next.consecutiveErrors).toBe(0);
  });

  it("LOADING + CANPLAY → PLAYING + เก็บ duration + รีเซ็ต error streak", () => {
    const loading = transition(initialPlayerContext(), { type: "LOAD", trackId: "a1" });
    const next = transition(
      { ...loading, consecutiveErrors: 2 },
      { type: "CANPLAY", durationMs: 213_000 },
    );
    expect(next.state).toBe("PLAYING");
    expect(next.durationMs).toBe(213_000);
    expect(next.consecutiveErrors).toBe(0);
  });

  it("#3 LOADING + PAUSE → ยัง LOADING แต่ pauseWhenReady; CANPLAY → PAUSED ทันที", () => {
    const loading = transition(initialPlayerContext(), { type: "LOAD", trackId: "a1" });
    const paused = transition(loading, { type: "PAUSE", positionMs: 0 });
    expect(paused.state).toBe("LOADING");
    expect(paused.pauseWhenReady).toBe(true);

    const ready = transition(paused, { type: "CANPLAY", durationMs: 100_000 });
    expect(ready.state).toBe("PAUSED");
    expect(ready.pauseWhenReady).toBe(false);
  });

  it("PLAYING + PAUSE → PAUSED + position อัปเดต; PAUSED + PAUSE ซ้ำ = no-op", () => {
    const p = playing({ positionMs: 42_000 });
    const paused = transition(p, { type: "PAUSE", positionMs: 43_500 });
    expect(paused.state).toBe("PAUSED");
    expect(paused.positionMs).toBe(43_500);
    expect(transition(paused, { type: "PAUSE", positionMs: 44_000 })).toBe(paused);
  });

  it("PAUSED + PLAYING event (resume) → PLAYING", () => {
    const paused = transition(playing(), { type: "PAUSE", positionMs: 10_000 });
    const resumed = transition(paused, { type: "PLAYING" });
    expect(resumed.state).toBe("PLAYING");
    expect(resumed.positionMs).toBe(10_000);
  });

  it("PLAYING + WAITING → BUFFERING; SEEKED → PLAYING", () => {
    const buffering = transition(playing({ positionMs: 5_000 }), {
      type: "WAITING",
      positionMs: 5_500,
    });
    expect(buffering.state).toBe("BUFFERING");
    const resumed = transition(buffering, { type: "SEEKED", positionMs: 5_500 });
    expect(resumed.state).toBe("PLAYING");
  });

  it("SEEK ระหว่าง PLAYING → BUFFERING + position clamp; บน IDLE = no-op", () => {
    const seeked = transition(playing(), { type: "SEEK", positionMs: 60_000 });
    expect(seeked.state).toBe("BUFFERING");
    expect(seeked.positionMs).toBe(60_000);

    expect(
      transition(initialPlayerContext(), { type: "SEEK", positionMs: 1_000 }),
    ).toStrictEqual(initialPlayerContext());
  });

  it("ENDED → ENDED + position = duration; caller ต้อง LOAD ใหม่เอง", () => {
    const ended = transition(playing({ positionMs: 200_000 }), { type: "ENDED" });
    expect(ended.state).toBe("ENDED");
    expect(ended.positionMs).toBe(213_000);
  });

  it("ERROR จาก PLAYING → ERROR + consecutiveErrors+1; บน IDLE = no-op", () => {
    const errored = transition(playing(), { type: "ERROR" });
    expect(errored.state).toBe("ERROR");
    expect(errored.consecutiveErrors).toBe(1);
    expect(transition(initialPlayerContext(), { type: "ERROR" })).toStrictEqual(
      initialPlayerContext(),
    );
  });

  it("#4 auto-advance ได้สูงสุด 2 ครั้ง (error ครบ 3 ติด → หยุด)", () => {
    let ctx = transition(playing(), { type: "ERROR" });
    expect(shouldAutoAdvance(ctx)).toBe(true); // ครั้งที่ 1 → advance ได้
    ctx = transition(transition(ctx, { type: "LOAD", trackId: "a2" }), {
      type: "ERROR",
    });
    expect(shouldAutoAdvance(ctx)).toBe(true); // ครั้งที่ 2 → advance ได้
    ctx = transition(transition(ctx, { type: "LOAD", trackId: "a3" }), {
      type: "ERROR",
    });
    expect(ctx.consecutiveErrors).toBe(3);
    expect(shouldAutoAdvance(ctx)).toBe(false);
    expect(MAX_CONSECUTIVE_ERRORS).toBe(3);
  });

  it("เล่นสำเร็จแล้ว error streak รีเซ็ต (CANPLAY ตั้ง 0)", () => {
    const errored = transition(playing(), { type: "ERROR" });
    const loaded = transition(errored, { type: "LOAD", trackId: "a2" });
    const ok = transition(loaded, { type: "CANPLAY", durationMs: 50_000 });
    expect(ok.consecutiveErrors).toBe(0);
  });

  it("STOP จาก state ใดก็ได้ → IDLE สะอาด", () => {
    expect(transition(playing(), { type: "STOP" })).toEqual(initialPlayerContext());
    expect(
      transition(transition(initialPlayerContext(), { type: "LOAD", trackId: "x" }), {
        type: "STOP",
      }),
    ).toEqual(initialPlayerContext());
  });
});

describe("clampSeek", () => {
  it("clamp [0, duration-1]", () => {
    const ctx = playing();
    expect(clampSeek(ctx, -5)).toBe(0);
    expect(clampSeek(ctx, 213_000)).toBe(212_999);
    expect(clampSeek(ctx, 60_000)).toBe(60_000);
  });

  it("duration ไม่รู้จัก → clamp แค่ขั้นล่าง", () => {
    expect(clampSeek(initialPlayerContext(), -1)).toBe(0);
    expect(clampSeek(initialPlayerContext(), 999_999)).toBe(999_999);
  });

  it("ปัดเป็นมิลลิวินาทีเต็ม", () => {
    expect(clampSeek(playing(), 60_000.7)).toBe(60_001);
  });
});
