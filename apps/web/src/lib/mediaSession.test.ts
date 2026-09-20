/**
 * Media Session — frontend.md §8.1: metadata/artwork + action handlers → AudioEngine;
 * ไม่มี navigator.mediaSession → ทุกอย่าง no-op (feature-detect)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackDTO } from "@musicplayer/shared";
import {
  initMediaSession,
  updateMediaSessionMetadata,
  updateMediaSessionPlaybackState,
  updateMediaSessionPosition,
  _setMediaSessionForTests,
  type MediaSessionLike,
} from "./mediaSession";

const { engineCalls } = vi.hoisted(() => ({
  engineCalls: [] as Array<{ fn: string; arg: unknown }>,
}));

vi.mock("./audioEngine", () => ({
  getAudioEngine: () => ({
    ensureAudioGraph: () => engineCalls.push({ fn: "ensureAudioGraph", arg: null }),
    resume: () => engineCalls.push({ fn: "resume", arg: null }),
    pause: () => engineCalls.push({ fn: "pause", arg: null }),
    previous: () => engineCalls.push({ fn: "previous", arg: null }),
    skip: () => engineCalls.push({ fn: "skip", arg: null }),
    seek: (ms: number) => engineCalls.push({ fn: "seek", arg: ms }),
  }),
}));

// useProgressStore จริง (zustand ไม่พึ่ง DOM) — subscribe ใน initMediaSession ใช้ตัวจริง
import { useProgressStore } from "../stores/playerStore";

const TRACK: TrackDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Test Song",
  artist: "Test Artist",
  album: "Test Album",
  durationMs: 200_000,
  isStream: false,
  isSeekable: true,
  artworkUrl: "https://example.com/art.jpg",
  sourceName: "youtube",
  isLiked: false,
};

interface FakeSession {
  metadata: unknown;
  playbackState: string;
  positionState: unknown;
  handlers: Map<string, ((details?: unknown) => void) | null>;
  setPositionState: (state: unknown) => void;
  setActionHandler: (
    action: string,
    handler: ((details?: unknown) => void) | null,
  ) => void;
}

function makeFakeSession(): FakeSession {
  const session: FakeSession = {
    metadata: null,
    playbackState: "none",
    positionState: null,
    handlers: new Map(),
    setPositionState(state: unknown) {
      session.positionState = state;
    },
    setActionHandler(action, handler) {
      session.handlers.set(action, handler);
    },
  };
  return session;
}

// jsdom ไม่มี MediaMetadata — stub ให้ constructor บันทึกค่า
class FakeMediaMetadata {
  title: string;
  artist: string;
  album: string;
  artwork: Array<{ src: string }>;
  constructor(init: {
    title: string;
    artist: string;
    album: string;
    artwork: Array<{ src: string }>;
  }) {
    this.title = init.title;
    this.artist = init.artist;
    this.album = init.album;
    this.artwork = init.artwork;
  }
}

beforeEach(() => {
  engineCalls.length = 0;
  (globalThis as { MediaMetadata?: unknown }).MediaMetadata = FakeMediaMetadata;
});

describe("initMediaSession", () => {
  it("ลงทะเบียน action handlers ครบ + handler เรียก engine", () => {
    const fake = makeFakeSession();
    _setMediaSessionForTests(fake as unknown as MediaSessionLike);
    initMediaSession();

    expect(fake.handlers.get("play")).toBeTruthy();
    (fake.handlers.get("play") as () => void)();
    expect(engineCalls.map((c) => c.fn)).toEqual(["ensureAudioGraph", "resume"]);

    (fake.handlers.get("nexttrack") as () => void)();
    (fake.handlers.get("previoustrack") as () => void)();
    (fake.handlers.get("pause") as () => void)();
    expect(engineCalls.map((c) => c.fn)).toContain("skip");
    expect(engineCalls.map((c) => c.fn)).toContain("previous");
    expect(engineCalls.map((c) => c.fn)).toContain("pause");

    (fake.handlers.get("seekto") as (d: unknown) => void)({ seekTime: 12.5 });
    expect(engineCalls.at(-1)).toEqual({ fn: "seek", arg: 12_500 });
  });

  it("position state ตาม progress store (subscribe)", () => {
    const fake = makeFakeSession();
    _setMediaSessionForTests(fake as unknown as MediaSessionLike);
    initMediaSession();
    useProgressStore.getState().setProgress(30_000, 200_000);
    expect(fake.positionState).toEqual({
      duration: 200,
      position: 30,
      playbackRate: 1,
    });
  });

  it("ไม่มี mediaSession → no-op ไม่ throw", () => {
    _setMediaSessionForTests(null);
    expect(() => initMediaSession()).not.toThrow();
    expect(() => updateMediaSessionMetadata(TRACK)).not.toThrow();
    expect(() => updateMediaSessionPlaybackState("PLAYING")).not.toThrow();
  });

  it("updateMediaSessionMetadata/playbackState", () => {
    const fake = makeFakeSession();
    _setMediaSessionForTests(fake as unknown as MediaSessionLike);

    updateMediaSessionMetadata(TRACK);
    const meta = fake.metadata as FakeMediaMetadata | null;
    expect(meta?.title).toBe("Test Song");
    expect(meta?.artist).toBe("Test Artist");
    expect(meta?.artwork[0]?.src).toBe("https://example.com/art.jpg");

    updateMediaSessionMetadata(null);
    expect(fake.metadata).toBeNull();

    updateMediaSessionPlaybackState("PLAYING");
    expect(fake.playbackState).toBe("playing");
    updateMediaSessionPlaybackState("PAUSED");
    expect(fake.playbackState).toBe("paused");
    updateMediaSessionPosition(5_000, 100_000);
    expect(fake.positionState).toEqual({ duration: 100, position: 5, playbackRate: 1 });
  });
});
