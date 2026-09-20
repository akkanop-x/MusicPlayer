import { beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeEvents } from "@musicplayer/shared";
import { usePlayerStore, useQueueStore, useToastStore } from "../stores/playerStore";
import { _resetRealtimeForTests, handleRealtimeEvent } from "./handlers";

const { engineCalls, fakeEngine } = vi.hoisted(() => {
  const engineCalls: Array<{ fn: string; arg: unknown }> = [];
  const fakeEngine = {
    applyRemotePlayerState: (p: unknown) =>
      engineCalls.push({ fn: "applyRemotePlayerState", arg: p }),
    applyTrackStarted: (p: unknown) =>
      engineCalls.push({ fn: "applyTrackStarted", arg: p }),
    applyRemotePosition: (p: unknown) =>
      engineCalls.push({ fn: "applyRemotePosition", arg: p }),
    applyRemoteVolume: (v: unknown, m: unknown) =>
      engineCalls.push({ fn: "applyRemoteVolume", arg: [v, m] }),
  };
  return { engineCalls, fakeEngine };
});

vi.mock("../lib/audioEngine", () => ({
  getAudioEngine: () => fakeEngine,
  _resetEngineForTests: () => undefined,
}));

const T1 = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Song",
  artist: "A",
  album: null,
  durationMs: 10_000,
  isStream: false,
  isSeekable: true,
  artworkUrl: null,
  sourceName: "youtube",
  isLiked: false,
};

beforeEach(() => {
  _resetRealtimeForTests();
  engineCalls.length = 0;
  useQueueStore.setState({ current: null, upcoming: [], history: [], version: 0 });
  usePlayerStore.setState({ ...usePlayerStore.getInitialState() });
  useToastStore.setState({ message: null });
});

describe("realtime handlers — version gate (websocket.md §2)", () => {
  it("event ใหม่กว่า → apply; event เก่ากว่า → ทิ้ง", () => {
    handleRealtimeEvent(RealtimeEvents.PositionUpdated, {
      positionMs: 1_000,
      version: 2,
    });
    handleRealtimeEvent(RealtimeEvents.PositionUpdated, {
      positionMs: 2_000,
      version: 1, // เก่ากว่า — ต้องถูกทิ้ง
    });
    expect(engineCalls).toHaveLength(1);
    expect(engineCalls[0]!.fn).toBe("applyRemotePosition");
    expect(engineCalls[0]!.arg).toBe(1_000);
  });

  it("version เท่าเดิม → ทิ้ง (ไม่ apply ซ้ำ)", () => {
    handleRealtimeEvent(RealtimeEvents.PositionUpdated, {
      positionMs: 1_000,
      version: 5,
    });
    handleRealtimeEvent(RealtimeEvents.PositionUpdated, {
      positionMs: 1_000,
      version: 5,
    });
    expect(engineCalls).toHaveLength(1);
  });
});

describe("realtime handlers — dispatch (websocket.md §3)", () => {
  it("PLAYER_STATE_CHANGED → AudioEngine.applyRemotePlayerState", () => {
    handleRealtimeEvent(RealtimeEvents.PlayerStateChanged, {
      state: "PAUSED",
      track: T1,
      positionMs: 3_000,
      version: 1,
    });
    expect(engineCalls[0]!.fn).toBe("applyRemotePlayerState");
  });

  it("TRACK_STARTED → AudioEngine.applyTrackStarted", () => {
    handleRealtimeEvent(RealtimeEvents.TrackStarted, {
      item: { id: "q1", track: T1 },
      positionMs: 0,
      version: 1,
    });
    expect(engineCalls[0]!.fn).toBe("applyTrackStarted");
  });

  it("QUEUE_UPDATED → queueStore replace ทั้งก้อน", () => {
    handleRealtimeEvent(RealtimeEvents.QueueUpdated, {
      queue: {
        current: { id: "q1", track: T1 },
        upcoming: [{ id: "q2", track: T1 }],
        history: [],
        version: 3,
      },
      version: 7,
    });
    const queue = useQueueStore.getState();
    expect(queue.current?.id).toBe("q1");
    expect(queue.upcoming).toHaveLength(1);
    expect(queue.version).toBe(3);
  });

  it("VOLUME_CHANGED → AudioEngine.applyRemoteVolume", () => {
    handleRealtimeEvent(RealtimeEvents.VolumeChanged, {
      volume: 25,
      muted: false,
      version: 1,
    });
    expect(engineCalls[0]!.fn).toBe("applyRemoteVolume");
    expect(engineCalls[0]!.arg).toEqual([25, false]);
  });

  it("TRACK_EXCEPTION → toast ข้อความจาก server", () => {
    handleRealtimeEvent(RealtimeEvents.TrackException, {
      item: null,
      code: "SOURCE_ERROR",
      message: "เล่นไม่ได้",
      version: 1,
    });
    expect(useToastStore.getState().message).toBe("เล่นไม่ได้");
  });

  it("QUEUE_ENDED → player state IDLE", () => {
    usePlayerStore.setState({ state: "PLAYING" });
    handleRealtimeEvent(RealtimeEvents.QueueEnded, { version: 9 });
    expect(usePlayerStore.getState().state).toBe("IDLE");
  });
});
