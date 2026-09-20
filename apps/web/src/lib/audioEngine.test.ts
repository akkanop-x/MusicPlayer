/**
 * Edge-case tests ฝั่ง client (player.md §5) — jsdom + stubbed media element
 * #1/#2: กด play รัว ๆ ตอน LOADING → element เดียว, src ล่าสุดชนะ, เสียงเก่าถูกหยุด
 * #3:    pause ตอน LOADING → pauseWhenReady → pause ทันทีที่ canplay
 * #4:    error → auto-advance; ครบ 3 ติด → IDLE + toast
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAudioEngine, _resetEngineForTests } from "./audioEngine";
import type { PlayerStateDTO, TrackDTO } from "@musicplayer/shared";

const T1: TrackDTO = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "T1",
  artist: "A",
  album: null,
  durationMs: 100_000,
  isStream: false,
  isSeekable: true,
  artworkUrl: null,
  sourceName: "youtube",
  isLiked: false,
};
const T2: TrackDTO = { ...T1, id: "22222222-2222-2222-2222-222222222222", title: "T2" };

function dto(state: PlayerStateDTO["state"], track: TrackDTO | null): PlayerStateDTO {
  return {
    state,
    track,
    positionMs: 0,
    volume: 80,
    muted: false,
    repeatMode: "off",
    shuffle: false,
    autoplay: true,
  };
}

/** deferred promise เพื่อจำลอง /player/play ที่ยังไม่ตอบ (LOADING ค้าง) */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const playerApiMock = vi.hoisted(() => ({
  play: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  seek: vi.fn(),
  skip: vi.fn(),
  previous: vi.fn(),
  setVolume: vi.fn(),
  setRepeat: vi.fn(),
  getState: vi.fn(),
}));

vi.mock("../api", () => ({ playerApi: playerApiMock }));

beforeEach(() => {
  // jsdom ไม่ implement media playback — stub เฉพาะ method ที่ engine เรียก
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
  _resetEngineForTests();
});

/** engine ใหม่ต่อ test — stores ยัง shared (ตรวจผลข้างเคียงได้) */
function freshEngine() {
  _resetEngineForTests();
  return getAudioEngine();
}

describe("AudioEngine edge cases", () => {
  it("singleton — element เดียวต่อ page", async () => {
    const engine = await freshEngine();
    expect(getAudioEngine()).toBe(getAudioEngine());
    expect(engine.element).toBeDefined();
  });

  it("#1/#2 กด play รัว ๆ ตอน LOADING → สั่ง pause เดิม + src ใหม่ชนะ (element เดียว = เสียงซ้อนไม่ได้)", async () => {
    const engine = await freshEngine();
    const first = deferred<PlayerStateDTO>();
    playerApiMock.play.mockImplementation((id: string) =>
      id === T1.id ? first.promise : Promise.resolve(dto("PLAYING", T2)),
    );

    const p1 = engine.play(T1); // ยังไม่ตอบ → LOADING ค้าง
    await engine.play(T2); // กดซ้ำ → ต้องตัดของเดิมแล้วชนะ
    first.resolve(dto("PLAYING", T1));
    await p1;

    const src = engine.element.src;
    expect(src).toContain(T2.id); // ล่าสุดชนะ
    expect(engine.element.pause).toHaveBeenCalled(); // เสียงเดิมถูกหยุดก่อนโหลดใหม่
    expect(engine.element.load).toHaveBeenCalled();
  });

  it("#3 pause ตอน LOADING → เก็บ intent → pause ทันทีที่ canplay", async () => {
    const engine = await freshEngine();
    const pending = deferred<PlayerStateDTO>();
    playerApiMock.play.mockReturnValue(pending.promise);
    playerApiMock.pause.mockResolvedValue(dto("PAUSED", T1));

    const loading = engine.play(T1);
    await engine.pause(); // ระหว่าง LOADING

    // canplay ระหว่าง intent ค้าง → element ต้องถูก pause
    pending.resolve(dto("PLAYING", T1));
    await loading;
    engine.element.dispatchEvent(new Event("canplay"));
    // canplay handler เรียก audio.pause() เองเมื่อ pauseWhenReady
    expect(engine.element.pause).toHaveBeenCalled();
  });

  it("#4 error ครบ 3 ติด → กลับ IDLE + toast (ไม่ advance ต่อ)", async () => {
    const { usePlayerStore, useToastStore } = await import("../stores/playerStore");
    const engine = await freshEngine();

    playerApiMock.play.mockResolvedValue(dto("PLAYING", T1));
    playerApiMock.skip.mockRejectedValue(new Error("No next track in queue"));

    for (let i = 0; i < 3; i++) {
      await engine.play(T1);
      engine.element.dispatchEvent(new Event("error"));
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(usePlayerStore.getState().state).toBe("IDLE");
    expect(useToastStore.getState().message).toContain("ไม่สำเร็จ");
  });
});
