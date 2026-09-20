/**
 * PlayerService — player.md §3/§4 (Phase 4: queue จำลอง 1 เพลง, ไม่มี WS)
 * - เก็บ player state ต่อ user in-memory; optimistic state: ตอบ PLAYING ทันทีตอน play
 * - transition ทั้งหมดผ่าน packages/shared/playerState (state machine เดียวกับ client)
 * - volume/repeatMode persist ลง userSettings (ตารางมีอยู่แล้ว — database.md §2.7)
 */
import type {
  PlayerStateDTO,
  QueueStateDTO,
  RepeatMode,
  TrackDTO,
} from "@musicplayer/shared";
import {
  initialPlayerContext,
  clampSeek,
  transition,
  type PlayerContext,
} from "@musicplayer/shared";

export class PlayerError extends Error {
  constructor(
    message: string,
    readonly code:
      | "TRACK_NOT_FOUND"
      | "NOT_PLAYING"
      | "NOT_PAUSED"
      | "NO_NEXT"
      | "NO_PREVIOUS"
      | "VALIDATION_ERROR",
  ) {
    super(message);
    this.name = "PlayerError";
  }
}

export interface PlayerSettings {
  volume: number;
  muted: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  autoplay: boolean;
}

export interface PlayerDeps {
  /** หา track เป็น TrackDTO (isLiked เติมตอน Phase 10 — ตอนนี้ false) */
  findTrack(trackId: string): Promise<TrackDTO | null>;
  getSettings(userId: string): Promise<PlayerSettings>;
  /** persist volume/repeatMode — ผิดพลาดได้ (fail-soft: in-memory ยังตอบได้) */
  saveSettings(
    userId: string,
    patch: Partial<Pick<PlayerSettings, "volume" | "repeatMode">>,
  ): Promise<void>;
}

const RESTART_THRESHOLD_MS = 3_000; // player.md §3: previous เมื่อเล่นเกิน 3 s → เริ่มเพลงเดิมใหม่

interface UserPlayer {
  ctx: PlayerContext;
  track: TrackDTO | null;
  settings: PlayerSettings | null; // lazy — โหลดครั้งแรกที่ touch
  history: TrackDTO[];
  queueVersion: number;
}

export function createPlayerService(deps: PlayerDeps) {
  const players = new Map<string, UserPlayer>();

  async function getUser(userId: string): Promise<UserPlayer> {
    let user = players.get(userId);
    if (!user) {
      user = {
        ctx: initialPlayerContext(),
        track: null,
        settings: await deps.getSettings(userId),
        history: [],
        queueVersion: 0,
      };
      players.set(userId, user);
    }
    return user;
  }

  function toStateDTO(user: UserPlayer): PlayerStateDTO {
    return {
      state: user.ctx.state,
      track: user.track,
      positionMs: user.ctx.positionMs,
      volume: user.settings!.volume,
      muted: user.settings!.muted,
      repeatMode: user.settings!.repeatMode,
      shuffle: user.settings!.shuffle,
      autoplay: user.settings!.autoplay,
    };
  }

  function toQueueDTO(user: UserPlayer): QueueStateDTO {
    return {
      current: user.track,
      upcoming: [], // Phase 4 queue จำลอง 1 เพลง — queue จริงเป็น Phase 5
      history: [...user.history],
      version: user.queueVersion,
    };
  }

  /** optimistic state (player.md §4): ตั้ง PLAYING ทันที ไม่รอเสียงจริง — client แก้ทีหลังผ่าน media events */
  function optimisticPlay(user: UserPlayer, track: TrackDTO): void {
    user.ctx = {
      ...transition(user.ctx, { type: "LOAD", trackId: track.id }),
      state: "PLAYING",
      durationMs: track.durationMs > 0 ? track.durationMs : null,
    };
    user.track = track;
  }

  async function getState(userId: string): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    return toStateDTO(user);
  }

  async function play(userId: string, trackId: string): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    const track = await deps.findTrack(trackId);
    if (!track) throw new PlayerError("Track not found", "TRACK_NOT_FOUND");

    if (user.track && user.track.id !== track.id) {
      // เก็บเพลงเดิมเป็น history (mock 1-track: จำกัด 10 ชุด)
      user.history = [
        user.track,
        ...user.history.filter((t) => t.id !== track.id),
      ].slice(0, 10);
    }
    user.queueVersion += 1;
    optimisticPlay(user, track);
    return toStateDTO(user);
  }

  async function pause(userId: string): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    if (
      user.ctx.state !== "PLAYING" &&
      user.ctx.state !== "BUFFERING" &&
      user.ctx.state !== "LOADING"
    ) {
      throw new PlayerError("Nothing is playing", "NOT_PLAYING");
    }
    user.ctx = transition(user.ctx, { type: "PAUSE", positionMs: user.ctx.positionMs });
    return toStateDTO(user);
  }

  async function resume(userId: string): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    if (user.ctx.state !== "PAUSED") {
      throw new PlayerError("Player is not paused", "NOT_PAUSED");
    }
    user.ctx = transition(user.ctx, { type: "PLAYING" });
    return toStateDTO(user);
  }

  async function seek(userId: string, positionMs: number): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    if (
      !user.track ||
      (user.ctx.state !== "PLAYING" &&
        user.ctx.state !== "PAUSED" &&
        user.ctx.state !== "BUFFERING")
    ) {
      throw new PlayerError("Nothing is playing", "NOT_PLAYING");
    }
    // api.md §4 #13: seek เกิน duration / บน live stream → 400 (client clamp เองก่อนก็ได้)
    if (user.track.isStream) {
      throw new PlayerError("Cannot seek on a live stream", "VALIDATION_ERROR");
    }
    if (
      positionMs < 0 ||
      (user.ctx.durationMs !== null && positionMs >= user.ctx.durationMs)
    ) {
      throw new PlayerError("Seek position out of range", "VALIDATION_ERROR");
    }
    user.ctx = transition(user.ctx, {
      type: "SEEK",
      positionMs: clampSeek(user.ctx, positionMs),
    });
    return toStateDTO(user);
  }

  /** Phase 4: queue จำลอง 1 เพลง — skip = เล่นเพลงเดิมซ้ำเมื่อ repeat one/all, ไม่งั้น NO_NEXT */
  async function skip(userId: string): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    if (!user.track) throw new PlayerError("Queue is empty", "NO_NEXT");
    if (user.settings!.repeatMode === "one" || user.settings!.repeatMode === "all") {
      user.ctx = transition(user.ctx, { type: "LOAD", trackId: user.track.id });
      optimisticPlay(user, user.track);
    } else {
      throw new PlayerError("No next track in queue", "NO_NEXT");
    }
    user.queueVersion += 1;
    return toQueueDTO(user);
  }

  /** player.md §3: เล่นเกิน 3 s → restart เพลงเดิม; ไม่งั้น pop history (mock 1-track) */
  async function previous(userId: string): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    if (!user.track) throw new PlayerError("Nothing is playing", "NOT_PLAYING");

    if (user.ctx.positionMs > RESTART_THRESHOLD_MS) {
      optimisticPlay(user, user.track);
      return toStateDTO(user);
    }
    const [prev, ...rest] = user.history;
    if (!prev) throw new PlayerError("No previous track", "NO_PREVIOUS");
    user.history = rest;
    user.queueVersion += 1;
    optimisticPlay(user, prev);
    return toStateDTO(user);
  }

  async function setVolume(userId: string, volume: number): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    user.settings = { ...user.settings!, volume, muted: volume === 0 };
    await deps.saveSettings(userId, { volume }).catch(() => undefined);
    return toStateDTO(user);
  }

  async function setRepeatMode(
    userId: string,
    mode: RepeatMode,
  ): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    user.settings = { ...user.settings!, repeatMode: mode };
    await deps.saveSettings(userId, { repeatMode: mode }).catch(() => undefined);
    return toStateDTO(user);
  }

  return {
    getState,
    play,
    pause,
    resume,
    seek,
    skip,
    previous,
    setVolume,
    setRepeatMode,
  };
}

export type PlayerService = ReturnType<typeof createPlayerService>;
