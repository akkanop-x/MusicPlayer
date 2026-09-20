/**
 * PlayerService — player.md §3/§4 + queue.md (Phase 5: queue จริง, ยังไม่มี WS)
 * ต่อ user มี state เดียว: player context + QueueModel (shared queueLogic) — รวมไว้
 * ที่เดียวกันเพื่อกัน state diverge (บทเรียน Phase 4)
 * optimistic state: ตอบ PLAYING ทันทีตอน play/skip; volume/repeat persist ลง userSettings;
 * queue ทุก mutation persist ผ่าน saveQueue (restore หลัง restart เป็น PAUSED เสมอ)
 */
import type {
  PlayerStateDTO,
  QueueItemDTO,
  QueueStateDTO,
  RepeatMode,
  TrackDTO,
} from "@musicplayer/shared";
import {
  addNext,
  addTracks,
  advance as queueAdvance,
  clearQueue,
  clampSeek,
  emptyQueue,
  makeQueueItem,
  moveInUpcoming,
  playNow,
  previous as queuePrevious,
  removeFromUpcoming,
  setShuffle,
  transition,
  QUEUE_HISTORY_CAP,
  type PlayerContext,
  type QueueModel,
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
      | "ITEM_IS_CURRENT"
      | "VALIDATION_ERROR"
      | "NOT_FOUND",
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

/** ข้อมูล queue ที่ persist ลง queue_snapshots + queue_items (queue.md §8) */
export interface QueueSnapshot {
  currentTrackId: string | null;
  positionMs: number;
  shuffleOn: boolean;
  repeatMode: RepeatMode;
  upcoming: Array<{ id: string; trackId: string; originalPosition: number }>;
  history: Array<{ id: string; trackId: string; originalPosition: number }>;
}

export interface PlayerDeps {
  findTrack(trackId: string): Promise<TrackDTO | null>;
  getSettings(userId: string): Promise<PlayerSettings>;
  saveSettings(
    userId: string,
    patch: Partial<Pick<PlayerSettings, "volume" | "repeatMode" | "shuffle">>,
  ): Promise<void>;
  /** โหลด queue ค้างจาก DB (null = ไม่มี snapshot) — เรียกครั้งแรกที่ user touch */
  loadQueue(userId: string): Promise<QueueSnapshot | null>;
  /** persist queue หลังทุก mutation (fail-soft: พังแล้ว in-memory ยังตอบได้) */
  saveQueue(userId: string, snapshot: QueueSnapshot): Promise<void>;
}

const RESTART_THRESHOLD_MS = 3_000; // player.md §3: previous เมื่อเล่นเกิน 3 s → เริ่มเพลงเดิมใหม่
const QUEUE_CAP = 500; // queue.md §11: cap 500 items/user

interface UserPlayer {
  ctx: PlayerContext;
  queue: QueueModel;
  settings: PlayerSettings | null;
  originalPosition: number; // counter ของ originalPosition (monotonic ต่อ user)
  version: number;
}

export function createPlayerService(deps: PlayerDeps) {
  const players = new Map<string, UserPlayer>();

  function nextOriginalPosition(user: UserPlayer): number {
    user.originalPosition += 1;
    return user.originalPosition;
  }

  async function fetchTrack(trackId: string): Promise<TrackDTO> {
    const track = await deps.findTrack(trackId);
    if (!track) throw new PlayerError("Track not found", "TRACK_NOT_FOUND");
    return track;
  }

  function emptyCtx(): PlayerContext {
    return {
      state: "IDLE",
      trackId: null,
      positionMs: 0,
      durationMs: null,
      pauseWhenReady: false,
      consecutiveErrors: 0,
    };
  }

  async function getUser(userId: string): Promise<UserPlayer> {
    let user = players.get(userId);
    if (!user) {
      user = {
        ctx: emptyCtx(),
        queue: emptyQueue(),
        settings: await deps.getSettings(userId),
        originalPosition: 0,
        version: 0,
      };
      players.set(userId, user);
      // restore จาก snapshot (restart backend → queue กลับมาแบบ PAUSED — player.md #7)
      const snap = await deps.loadQueue(userId).catch(() => null);
      if (snap) await restoreFromSnapshot(user, snap);
    }
    return user;
  }

  async function restoreFromSnapshot(
    user: UserPlayer,
    snap: QueueSnapshot,
  ): Promise<void> {
    const trackCache = new Map<string, Promise<TrackDTO | null>>();
    const getTrack = (id: string): Promise<TrackDTO | null> => {
      if (!trackCache.has(id))
        trackCache.set(
          id,
          deps.findTrack(id).catch(() => null),
        );
      return trackCache.get(id)!;
    };
    // track ที่ถูกลบไปแล้ว → ข้าม item นั้น (queue.md §9: previous เจอ track ถูกลบ = ข้าม)
    const toItem = async (row: {
      id: string;
      trackId: string;
      originalPosition: number;
    }) => {
      const track = await getTrack(row.trackId);
      return track
        ? { id: row.id, track, originalPosition: row.originalPosition }
        : null;
    };
    const upcoming = (await Promise.all(snap.upcoming.map(toItem))).filter(
      (i): i is NonNullable<typeof i> => i !== null,
    );
    const history = (await Promise.all(snap.history.map(toItem))).filter(
      (i): i is NonNullable<typeof i> => i !== null,
    );
    user.queue = {
      current: null,
      upcoming,
      history,
      shuffleOrder: snap.shuffleOn ? upcoming.map((_, i) => i) : null,
      roundStartId: null,
    };
    user.originalPosition = Math.max(
      0,
      ...upcoming.map((i) => i.originalPosition),
      ...history.map((i) => i.originalPosition),
    );
    if (snap.currentTrackId) {
      const track = await getTrack(snap.currentTrackId);
      if (track) {
        user.queue.current = makeQueueItem(track, 0);
        // restore เป็น PAUSED ณ ตำแหน่ง snapshot — ห้าม auto-play
        user.ctx = {
          ...emptyCtx(),
          state: "PAUSED",
          trackId: track.id,
          positionMs: snap.positionMs,
          durationMs: track.durationMs > 0 ? track.durationMs : null,
        };
      }
    }
  }

  function snapshotOf(user: UserPlayer): QueueSnapshot {
    return {
      currentTrackId: user.queue.current?.track.id ?? null,
      positionMs: user.ctx.positionMs,
      shuffleOn: user.queue.shuffleOrder !== null,
      repeatMode: user.settings!.repeatMode,
      upcoming: user.queue.upcoming.map((i) => ({
        id: i.id,
        trackId: i.track.id,
        originalPosition: i.originalPosition,
      })),
      history: user.queue.history.slice(0, QUEUE_HISTORY_CAP).map((i) => ({
        id: i.id,
        trackId: i.track.id,
        originalPosition: i.originalPosition,
      })),
    };
  }

  async function persist(user: UserPlayer, userId: string): Promise<void> {
    await deps.saveQueue(userId, snapshotOf(user)).catch(() => undefined);
  }

  function toStateDTO(user: UserPlayer): PlayerStateDTO {
    return {
      state: user.ctx.state,
      track: user.queue.current?.track ?? null,
      positionMs: user.ctx.positionMs,
      volume: user.settings!.volume,
      muted: user.settings!.muted,
      repeatMode: user.settings!.repeatMode,
      shuffle: user.settings!.shuffle,
      autoplay: user.settings!.autoplay,
    };
  }

  function toQueueDTO(user: UserPlayer): QueueStateDTO {
    const toDto = (i: { id: string; track: TrackDTO }): QueueItemDTO => ({
      id: i.id,
      track: i.track,
    });
    return {
      current: user.queue.current ? toDto(user.queue.current) : null,
      upcoming: user.queue.upcoming.map(toDto),
      history: user.queue.history.map(toDto),
      version: user.version,
    };
  }

  /** optimistic state (player.md §4): ตั้ง PLAYING ทันที ไม่รอเสียงจริง */
  function optimisticPlay(user: UserPlayer, track: TrackDTO): void {
    user.ctx = {
      ...transition(user.ctx, { type: "LOAD", trackId: track.id }),
      state: "PLAYING",
      durationMs: track.durationMs > 0 ? track.durationMs : null,
    };
  }

  async function getState(userId: string): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    return toStateDTO(user);
  }

  async function getQueue(userId: string): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    return toQueueDTO(user);
  }

  /** play now — api.md §4 #10: แทนที่ upcoming (Spotify behavior) */
  async function play(userId: string, trackId: string): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    const track = await fetchTrack(trackId);
    playNow(user.queue, makeQueueItem(track, nextOriginalPosition(user)));
    user.version += 1;
    optimisticPlay(user, track);
    await persist(user, userId);
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
    await persist(user, userId);
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
    const track = user.queue.current?.track;
    if (
      !track ||
      (user.ctx.state !== "PLAYING" &&
        user.ctx.state !== "PAUSED" &&
        user.ctx.state !== "BUFFERING")
    ) {
      throw new PlayerError("Nothing is playing", "NOT_PLAYING");
    }
    // api.md §4 #13: seek เกิน duration / บน live stream → 400
    if (track.isStream) {
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

  /**
   * advance (queue.md §5) — reason: "skip" = ผู้ใช้กดข้าม (repeat=one ก็ได้เพลงถัดไป),
   * "completed" = เพลงจบเอง (repeat=one → replay current ไม่เปลือง history)
   */
  async function skip(
    userId: string,
    reason: "completed" | "skip" = "skip",
  ): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    if (!user.queue.current && user.queue.upcoming.length === 0) {
      throw new PlayerError("Queue is empty", "NO_NEXT");
    }
    const played = queueAdvance(user.queue, reason, user.settings!.repeatMode);
    if (!played) throw new PlayerError("No next track in queue", "NO_NEXT");
    user.version += 1;
    optimisticPlay(user, played.track);
    await persist(user, userId);
    return toQueueDTO(user);
  }

  /**
   * previous (queue.md §6) — server ทำ pop history; การ "restart เมื่อ >3 s" ให้ client
   * ตัดสินเอง (client รู้ position จริง — ยังไม่มี WS/POSITION_SYNC จนถึง Phase 7)
   */
  async function previous(userId: string): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    if (!user.queue.current) throw new PlayerError("Nothing is playing", "NOT_PLAYING");
    if (user.ctx.positionMs > RESTART_THRESHOLD_MS) {
      user.ctx = transition(user.ctx, { type: "SEEK", positionMs: 0 });
      return toStateDTO(user);
    }
    const prev = queuePrevious(user.queue);
    if (!prev) throw new PlayerError("No previous track", "NO_PREVIOUS");
    user.version += 1;
    optimisticPlay(user, prev.track);
    await persist(user, userId);
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
    await persist(user, userId);
    return toStateDTO(user);
  }

  async function setShuffleEnabled(
    userId: string,
    enabled: boolean,
  ): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    user.settings = { ...user.settings!, shuffle: enabled };
    setShuffle(user.queue, enabled);
    user.version += 1;
    await deps.saveSettings(userId, { shuffle: enabled }).catch(() => undefined);
    await persist(user, userId);
    return toQueueDTO(user);
  }

  // ---------- queue operations (api.md §5) ----------

  async function makeItems(
    user: UserPlayer,
    trackIds: string[],
  ): Promise<{ id: string; track: TrackDTO; originalPosition: number }[]> {
    const items = [];
    for (const trackId of trackIds) {
      const track = await fetchTrack(trackId);
      items.push(makeQueueItem(track, nextOriginalPosition(user)));
    }
    return items;
  }

  async function assertQueueCap(user: UserPlayer, count: number): Promise<void> {
    if (user.queue.upcoming.length + count > QUEUE_CAP) {
      throw new PlayerError(`Queue cap is ${QUEUE_CAP} items`, "VALIDATION_ERROR");
    }
  }

  async function addToQueue(
    userId: string,
    trackIds: string[],
  ): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    await assertQueueCap(user, trackIds.length);
    const items = await makeItems(user, trackIds);
    addTracks(user.queue, items);
    user.version += 1;
    await persist(user, userId);
    return toQueueDTO(user);
  }

  async function addNextToQueue(
    userId: string,
    trackIds: string[],
  ): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    await assertQueueCap(user, trackIds.length);
    const items = await makeItems(user, trackIds);
    // trackIds ต้องอยู่ในลำดับเดิมหลังแทรกหน้าสุด → แทรกย้อนกลับ
    for (const item of items.reverse()) addNext(user.queue, item);
    user.version += 1;
    await persist(user, userId);
    return toQueueDTO(user);
  }

  async function removeQueueItem(
    userId: string,
    itemId: string,
  ): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    if (user.queue.current?.id === itemId) {
      // api.md §5: remove current → 409 ให้ client ใช้ skip แทน (กัน ambiguity)
      throw new PlayerError(
        "Cannot remove the current track — use skip",
        "ITEM_IS_CURRENT",
      );
    }
    if (!removeFromUpcoming(user.queue, itemId)) {
      throw new PlayerError("Queue item not found", "NOT_FOUND");
    }
    user.version += 1;
    await persist(user, userId);
    return toQueueDTO(user);
  }

  async function moveQueueItem(
    userId: string,
    itemId: string,
    toPosition: number,
  ): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    if (!moveInUpcoming(user.queue, itemId, toPosition)) {
      throw new PlayerError("Queue item not found", "NOT_FOUND");
    }
    user.version += 1;
    await persist(user, userId);
    return toQueueDTO(user);
  }

  async function clear(
    userId: string,
    scope: "upcoming" | "all",
  ): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    clearQueue(user.queue, scope);
    if (scope === "all") user.ctx = { ...emptyCtx(), state: "IDLE" };
    user.version += 1;
    await persist(user, userId);
    return toQueueDTO(user);
  }

  return {
    getState,
    getQueue,
    play,
    pause,
    resume,
    seek,
    skip,
    previous,
    setVolume,
    setRepeatMode,
    setShuffleEnabled,
    addToQueue,
    addNextToQueue,
    removeQueueItem,
    moveQueueItem,
    clear,
  };
}

export type PlayerService = ReturnType<typeof createPlayerService>;
