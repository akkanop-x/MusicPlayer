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
  RealtimeEventName,
  RepeatMode,
  TrackDTO,
} from "@musicplayer/shared";
import { RealtimeEvents } from "@musicplayer/shared";
import type { Broadcaster } from "../realtime/RealtimeHub.js";
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
      | "NO_RADIO"
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
  /**
   * Phase 10 — listening_history (queue.md §9): เรียกตอนเพลงจบ ("completed") หรือ
   * ถูกแทน/skip ("skip") — HistoryService.record; ไม่ส่ง = ไม่บันทึก history
   */
  onPlaybackEnded?: (
    userId: string,
    input: { track: TrackDTO; positionMs: number; reason: "completed" | "skip" },
  ) => void;
  /**
   * Phase 11/12 — autoplay + radio (queue.md §5 4b/§7, recommendation.md §6): คืนเพลง
   * ที่เล่นได้และไม่ซ้ำ exclude (RecommendationProvider ผ่าน app.ts — ไม่ส่ง = ปิดสนิท)
   */
  recommend?: (input: {
    userId: string;
    seedTrackId: string;
    exclude: string[];
    limit: number;
    /** §6 adaptive — ศิลปินที่เพลงเล่นจบใน radio นี้ (provider ให้ weight เพิ่ม) */
    boostArtists?: string[];
  }) => Promise<TrackDTO[]>;
  /** websocket.md §3 — emit ไปยังทุก connection ของ user (RealtimeHub; ไม่ส่ง = ไม่มี realtime) */
  broadcaster?: Broadcaster;
}

const RESTART_THRESHOLD_MS = 3_000; // player.md §3: previous เมื่อเล่นเกิน 3 s → เริ่มเพลงเดิมใหม่
const QUEUE_CAP = 500; // queue.md §11: cap 500 items/user
/** websocket.md §4 POSITION_SYNC: เดินหน้าไม่เร็วกว่า real-time × 1.2 (+ tolerance เผื่อ jitter) */
const SYNC_SPEED_FACTOR = 1.2;
const SYNC_TOLERANCE_MS = 1_500;
/** websocket.md §4 TRACK_STALLED: รายงานครบ 3 ครั้งใน 30 s → exception + advance */
const STALL_THRESHOLD = 3;
const STALL_WINDOW_MS = 30_000;
/** queue.md §7 — autoplay refill/prefetch: extend 10 เพลง, prefetch ก่อนเพลงจบ 30 s */
const AUTOPLAY_LIMIT = 10;
const PREFETCH_WINDOW_MS = 30_000;

interface UserPlayer {
  ctx: PlayerContext;
  queue: QueueModel;
  settings: PlayerSettings | null;
  originalPosition: number; // counter ของ originalPosition (monotonic ต่อ user)
  version: number;
  /** POSITION_SYNC ล่าสุด — ใช้ตรวจความเร็ว (×1.2) และตัดสิน stale ภายหลัง (websocket.md §6) */
  lastSync: { positionMs: number; at: number } | null;
  /** timestamps ของ STALLED reports ที่ยังอยู่ในหน้าต่าง 30 s */
  stalls: number[];
  /** prefetch recommendation กำลังรันอยู่ (กันยิงซ้ำทุก sync) */
  prefetching: boolean;
  /** Phase 12 — radio ที่กำลังเปิด (seed ตั้งต้น + ศิลปินที่เล่นจบเพื่อ adaptive §6); null = ปิด */
  radio: { seedTrackId: string; playedArtists: string[] } | null;
}

export function createPlayerService(deps: PlayerDeps) {
  const players = new Map<string, UserPlayer>();

  /** websocket.md §3 — broadcast ไปทุก connection ของ user (RealtimeHub แนบ version ให้) */
  function emit(
    userId: string,
    event: RealtimeEventName,
    payload: Record<string, unknown>,
  ): void {
    deps.broadcaster?.emitToUser(userId, event, payload);
  }

  function nextOriginalPosition(user: UserPlayer): number {
    user.originalPosition += 1;
    return user.originalPosition;
  }

  /**
   * listening_history (queue.md §9) — เรียกก่อน queue ถูก mutate (ต้องมี current อยู่);
   * completed → ใช้ duration เต็ม (ถ้ารู้), skip → ใช้ position ล่าสุดจาก POSITION_SYNC
   */
  function recordPlaybackEnd(
    user: UserPlayer,
    userId: string,
    reason: "completed" | "skip",
  ): void {
    const track = user.queue.current?.track;
    if (!track || !deps.onPlaybackEnded) return;
    const positionMs =
      reason === "completed" && user.ctx.durationMs !== null
        ? user.ctx.durationMs
        : user.ctx.positionMs;
    void deps.onPlaybackEnded(userId, { track, positionMs, reason });
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
        lastSync: null,
        stalls: [],
        prefetching: false,
        radio: null,
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
      radio: user.radio !== null,
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

  /** PLAYER_STATE_CHANGED payload มาตรฐาน — แนบ autoplay/radio ให้ client sync ข้าม tab */
  function stateChangedPayload(user: UserPlayer): Record<string, unknown> {
    return {
      state: user.ctx.state,
      track: user.queue.current?.track ?? null,
      positionMs: user.ctx.positionMs,
      autoplay: user.settings!.autoplay,
      radio: user.radio !== null,
    };
  }

  /**
   * queue.md §5 4b — queue หมด (upcoming ว่าง, repeat off) + autoplay เปิด (หรือ radio
   * กำลังเปิด — radio เล่นต่อเนื่องแม้ toggle autoplay ปิด) → ขอ recommendation
   * (exclude = ทุก track ใน queue session) → ตัวแรกเป็น current, ที่เหลือเข้า upcoming;
   * seed = radio seed ของสถานี (คงแนวเพลงเดิม) ไม่ใช่เพลงที่เพิ่งจบ; คืน true เมื่อเติมสำเร็จ
   */
  async function autoplayRefill(
    user: UserPlayer,
    userId: string,
    seedTrackId: string | null,
  ): Promise<boolean> {
    if (!deps.recommend || (!user.settings!.autoplay && !user.radio)) return false;
    const seed = user.radio?.seedTrackId ?? seedTrackId;
    if (!seed) return false;
    const exclude = queueTrackIds(user);
    const tracks = await deps
      .recommend({
        userId,
        seedTrackId: seed,
        exclude: [...exclude],
        limit: AUTOPLAY_LIMIT,
        boostArtists: user.radio?.playedArtists,
      })
      .catch(() => []);
    const fresh = tracks.filter(
      (t) =>
        !exclude.has(t.id) &&
        user.queue.current?.track.id !== t.id &&
        !user.queue.upcoming.some((i) => i.track.id === t.id),
    );
    if (fresh.length === 0) return false;
    const items = fresh.map((t) => makeQueueItem(t, nextOriginalPosition(user)));
    user.queue.current = items[0]!;
    user.queue.upcoming.push(...items.slice(1));
    return true;
  }

  /** queue.md §7 — prefetch: upcoming < 2 และเหลือ < 30 s → เติม 10 ก่อนเพลงจบ (fire-and-forget) */
  function maybePrefetch(user: UserPlayer, userId: string): void {
    if (!deps.recommend || (!user.settings!.autoplay && !user.radio)) return;
    if (user.queue.upcoming.length >= 2) return;
    const { durationMs, positionMs } = user.ctx;
    if (durationMs === null || durationMs - positionMs > PREFETCH_WINDOW_MS) return;
    const seedTrackId = user.radio?.seedTrackId ?? user.queue.current?.track.id;
    if (!seedTrackId) return;
    user.prefetching = true;
    void deps
      .recommend({
        userId,
        seedTrackId,
        exclude: [...queueTrackIds(user)],
        limit: AUTOPLAY_LIMIT,
        boostArtists: user.radio?.playedArtists,
      })
      .then((tracks) => {
        // ระหว่างรอ queue อาจถูก advance/clear — เติมเมื่อยังมี current และยังเล่นอยู่เท่านั้น
        if (!user.queue.current || user.ctx.state === "IDLE") return;
        const taken = queueTrackIds(user);
        const fresh = tracks.filter((t) => !taken.has(t.id));
        if (fresh.length === 0) return;
        user.queue.upcoming.push(
          ...fresh.map((t) => makeQueueItem(t, nextOriginalPosition(user))),
        );
        user.version += 1;
        void persist(user, userId);
        emit(userId, RealtimeEvents.QueueUpdated, { queue: toQueueDTO(user) });
      })
      .catch(() => undefined)
      .finally(() => {
        user.prefetching = false;
      });
  }

  /** trackId ทั้งหมดใน queue session (current + upcoming + history) — ใช้เป็น exclude set */
  function queueTrackIds(user: UserPlayer): Set<string> {
    const ids = new Set<string>();
    if (user.queue.current) ids.add(user.queue.current.track.id);
    for (const i of user.queue.upcoming) ids.add(i.track.id);
    for (const i of user.queue.history) ids.add(i.track.id);
    return ids;
  }

  /** optimistic state (player.md §4): ตั้ง PLAYING ทันที ไม่รอเสียงจริง */
  function optimisticPlay(user: UserPlayer, track: TrackDTO): void {
    // track ใหม่เริ่มที่ 0 เสมอ — anchor POSITION_SYNC ของเพลงเก่าใช้เทียบไม่ได้แล้ว
    user.lastSync = null;
    user.ctx = {
      ...transition(user.ctx, { type: "LOAD", trackId: track.id }),
      state: "PLAYING",
      durationMs: track.durationMs > 0 ? track.durationMs : null,
    };
  }

  // ---------- realtime emissions (websocket.md §3) ----------
  function itemDto(user: UserPlayer): { id: string; track: TrackDTO } | null {
    return user.queue.current
      ? { id: user.queue.current.id, track: user.queue.current.track }
      : null;
  }

  /** ชุด event มาตรฐานตอน "เริ่มเพลงใหม่" (play/skip/previous/autoplay) — websocket.md §3 */
  function emitTrackStarted(user: UserPlayer, userId: string): void {
    const item = itemDto(user);
    if (!item) return;
    emit(userId, RealtimeEvents.PlayerStateChanged, stateChangedPayload(user));
    emit(userId, RealtimeEvents.TrackStarted, { item, positionMs: 0 });
    emit(userId, RealtimeEvents.QueueUpdated, { queue: toQueueDTO(user) });
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
    // เพลงเดิมถูกแทนกลางคัน → บันทึก history เป็น skip ณ ตำแหน่งล่าสุด
    if (user.queue.current) recordPlaybackEnd(user, userId, "skip");
    user.radio = null; // เล่นเพลงเอง = ออกจาก radio
    playNow(user.queue, makeQueueItem(track, nextOriginalPosition(user)));
    user.version += 1;
    optimisticPlay(user, track);
    await persist(user, userId);
    emitTrackStarted(user, userId);
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
    emit(userId, RealtimeEvents.PlayerStateChanged, stateChangedPayload(user));
    return toStateDTO(user);
  }

  async function resume(userId: string): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    if (user.ctx.state !== "PAUSED") {
      throw new PlayerError("Player is not paused", "NOT_PAUSED");
    }
    user.ctx = transition(user.ctx, { type: "PLAYING" });
    emit(userId, RealtimeEvents.PlayerStateChanged, stateChangedPayload(user));
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
    // SEEK → BUFFERING ชั่วคราว (player.md §3) — แต่ server ไม่มี media element จึงไม่มี
    // SEEKED คืน: จบ seek แล้วเล่นต่อทันที (E2E J6 เจอ ctx ค้าง BUFFERING ตลอดหลัง seek)
    if (user.ctx.state === "BUFFERING") {
      user.ctx = transition(user.ctx, {
        type: "SEEKED",
        positionMs: user.ctx.positionMs,
      });
    }
    // POSITION_SYNC guard (×1.2) ต้องเทียบกับ anchor ใหม่ ณ ตำแหน่ง seek — ถ้าปล่อย
    // anchor เดิม (ก่อน seek) sync ถัดไปของ client จะโดน reject ตลอดกาล แล้ว wsServer
    // ส่ง POSITION_UPDATED ค่าเก่ากลับมาดึงเสียงกลับทุก 5 s = เพลงวนซ้ำช่วงเดิม
    user.lastSync = { positionMs: user.ctx.positionMs, at: Date.now() };
    emit(userId, RealtimeEvents.PlayerStateChanged, stateChangedPayload(user));
    emit(userId, RealtimeEvents.PositionUpdated, {
      positionMs: user.ctx.positionMs,
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
    const seedTrackId = user.queue.current?.track.id ?? null;
    if (user.queue.current) recordPlaybackEnd(user, userId, "skip");
    let played = queueAdvance(user.queue, reason, user.settings!.repeatMode);
    // queue.md §5 4b — คิวหมด + autoplay → เติมจาก recommendation แทนการจบ
    if (!played && (await autoplayRefill(user, userId, seedTrackId))) {
      played = user.queue.current;
    }
    if (!played) throw new PlayerError("No next track in queue", "NO_NEXT");
    user.version += 1;
    optimisticPlay(user, played.track);
    await persist(user, userId);
    emitTrackStarted(user, userId);
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
      emit(userId, RealtimeEvents.PositionUpdated, { positionMs: 0 });
      return toStateDTO(user);
    }
    const prev = queuePrevious(user.queue);
    if (!prev) throw new PlayerError("No previous track", "NO_PREVIOUS");
    user.version += 1;
    optimisticPlay(user, prev.track);
    await persist(user, userId);
    emitTrackStarted(user, userId);
    return toStateDTO(user);
  }

  async function setVolume(userId: string, volume: number): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    user.settings = { ...user.settings!, volume, muted: volume === 0 };
    await deps.saveSettings(userId, { volume }).catch(() => undefined);
    emit(userId, RealtimeEvents.VolumeChanged, {
      volume: user.settings.volume,
      muted: user.settings.muted,
    });
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
    emit(userId, RealtimeEvents.PlayerStateChanged, stateChangedPayload(user));
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
    emit(userId, RealtimeEvents.PlayerStateChanged, stateChangedPayload(user));
    emit(userId, RealtimeEvents.QueueUpdated, { queue: toQueueDTO(user) });
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
    emit(userId, RealtimeEvents.QueueUpdated, { queue: toQueueDTO(user) });
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
    emit(userId, RealtimeEvents.QueueUpdated, { queue: toQueueDTO(user) });
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
    emit(userId, RealtimeEvents.QueueUpdated, { queue: toQueueDTO(user) });
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
    emit(userId, RealtimeEvents.QueueUpdated, { queue: toQueueDTO(user) });
    return toQueueDTO(user);
  }

  async function clear(
    userId: string,
    scope: "upcoming" | "all",
  ): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    clearQueue(user.queue, scope);
    if (scope === "all") {
      user.ctx = { ...emptyCtx(), state: "IDLE" };
      user.radio = null;
    }
    user.version += 1;
    await persist(user, userId);
    emit(userId, RealtimeEvents.QueueUpdated, { queue: toQueueDTO(user) });
    if (scope === "all") {
      emit(userId, RealtimeEvents.PlayerStateChanged, stateChangedPayload(user));
    }
    return toQueueDTO(user);
  }

  /**
   * Phase 11 — toggle autoplay (api.md #39 PATCH /settings เป็นผู้ persist;
   * ที่นี่อัปเดต in-memory + broadcast ให้ทุก tab เห็นปุ่มสถานะเดียวกัน)
   */
  async function setAutoplay(
    userId: string,
    enabled: boolean,
  ): Promise<PlayerStateDTO> {
    const user = await getUser(userId);
    user.settings = { ...user.settings!, autoplay: enabled };
    emit(userId, RealtimeEvents.PlayerStateChanged, stateChangedPayload(user));
    return toStateDTO(user);
  }

  // ---------- radio (api.md §11 #46/47 — recommendation.md §6) ----------

  const RADIO_START_LIMIT = 20;

  /**
   * POST /radio/start — queue ถูกแทนด้วย radio: current = seed, upcoming = เพลงแนวเดียว
   * กับ seed (genre constraint อยู่ที่ provider §2.1.1) จำนวน 20; ขณะ radio active
   * refill/prefetch ทำงานเหมือน autoplay (ใช้ seed ของสถานี) แม้ toggle autoplay ปิด
   */
  async function startRadio(
    userId: string,
    seedTrackId: string,
  ): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    const seedTrack = await fetchTrack(seedTrackId);
    if (user.queue.current) recordPlaybackEnd(user, userId, "skip");
    user.queue = emptyQueue();
    user.radio = { seedTrackId: seedTrack.id, playedArtists: [] };
    user.queue.current = makeQueueItem(seedTrack, nextOriginalPosition(user));
    const exclude = queueTrackIds(user);
    const tracks = deps.recommend
      ? await deps
          .recommend({
            userId,
            seedTrackId: seedTrack.id,
            exclude: [...exclude],
            limit: RADIO_START_LIMIT,
          })
          .catch(() => [])
      : [];
    const fresh = tracks.filter(
      (t) =>
        !exclude.has(t.id) && !user.queue.upcoming.some((i) => i.track.id === t.id),
    );
    user.queue.upcoming.push(
      ...fresh.map((t) => makeQueueItem(t, nextOriginalPosition(user))),
    );
    user.version += 1;
    optimisticPlay(user, seedTrack);
    await persist(user, userId);
    emitTrackStarted(user, userId);
    return toQueueDTO(user);
  }

  /** POST /radio/extend — เติม upcoming เพิ่ม 10 ตาม seed ของสถานี (ต้องมี radio อยู่ก่อน) */
  async function extendRadio(userId: string): Promise<QueueStateDTO> {
    const user = await getUser(userId);
    if (!user.radio || !deps.recommend) {
      throw new PlayerError("No radio is active", "NO_RADIO");
    }
    const fresh = (
      await deps
        .recommend({
          userId,
          seedTrackId: user.radio.seedTrackId,
          exclude: [...queueTrackIds(user)],
          limit: AUTOPLAY_LIMIT,
          boostArtists: user.radio.playedArtists,
        })
        .catch(() => [])
    ).filter((t) => !queueTrackIds(user).has(t.id));
    user.queue.upcoming.push(
      ...fresh.map((t) => makeQueueItem(t, nextOriginalPosition(user))),
    );
    user.version += 1;
    await persist(user, userId);
    emit(userId, RealtimeEvents.QueueUpdated, { queue: toQueueDTO(user) });
    return toQueueDTO(user);
  }

  // ---------- realtime client → server (websocket.md §4) ----------

  /**
   * POSITION_SYNC — client ส่งทุก 5 s ขณะเล่น + ตอน pause/seek/ended
   * validate: เดินหน้าไม่เร็วกว่า real-time × 1.2 (+ tolerance), ≤ duration, ต้องมี current
   * คืนตำแหน่ง authoritative ของ server เสมอ — ok:false แล้ว caller ใช้ค่านี้ emit
   * POSITION_UPDATED จูน client กลับมาทันที (ไม่ต้อง getState ย้อนหลัง = ไม่มี race gap)
   */
  function syncPosition(
    userId: string,
    positionMs: number,
    now = Date.now(),
  ): { ok: boolean; positionMs: number } {
    const user = players.get(userId);
    if (!user || !user.queue.current) {
      return { ok: false, positionMs: 0 };
    }
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      return { ok: false, positionMs: user.ctx.positionMs };
    }

    const reject = (): { ok: boolean; positionMs: number } => {
      // re-anchor ที่ตำแหน่ง server ปัจจุบันทุกครั้งที่ reject — client ถูกจูนกลับมาแล้ว
      // ต้องเริ่มเทียบจาก anchor ใหม่ มิฉะนั้น sync ถัด ๆ ไปโดน reject ตลอดกาล
      // (anchor เก่าไม่มีทาง advance เพราะ accepted sync ไม่มีอีก) = ลูปจูนกลับทุก 5 s
      user.lastSync = { positionMs: user.ctx.positionMs, at: now };
      return { ok: false, positionMs: user.ctx.positionMs };
    };

    const durationMs = user.ctx.durationMs;
    if (durationMs !== null && positionMs > durationMs) return reject();

    const playing = user.ctx.state === "PLAYING" || user.ctx.state === "BUFFERING";
    if (playing && user.lastSync) {
      const elapsed = now - user.lastSync.at;
      const maxAllowed =
        user.lastSync.positionMs + elapsed * SYNC_SPEED_FACTOR + SYNC_TOLERANCE_MS;
      if (positionMs > maxAllowed) return reject();
    }
    user.ctx.positionMs = positionMs;
    user.lastSync = { positionMs, at: now };
    maybePrefetch(user, userId);
    return { ok: true, positionMs: user.ctx.positionMs };
  }

  /** ชุด event ตอนจบคิว (ไม่มีเพลงถัดไป + repeat off + autoplay ไม่เติมได้) — websocket.md QUEUE_ENDED */
  function emitQueueEnded(user: UserPlayer, userId: string): void {
    user.ctx = { ...emptyCtx(), state: "IDLE" };
    emit(userId, RealtimeEvents.QueueEnded, {});
    emit(userId, RealtimeEvents.QueueUpdated, { queue: toQueueDTO(user) });
    emit(userId, RealtimeEvents.PlayerStateChanged, stateChangedPayload(user));
  }

  /**
   * TRACK_ENDED (client report) — ตรง current เท่านั้น → advance ("completed");
   * คิวหมด (repeat off) → QUEUE_ENDED + IDLE แทนการ throw NO_NEXT
   */
  async function reportTrackEnded(
    userId: string,
    trackId: string,
  ): Promise<{ ended: boolean }> {
    const user = await getUser(userId);
    if (user.queue.current?.track.id !== trackId) return { ended: false };
    // §6 adaptive — เพลง radio เล่นจบ (ไม่ skip) → จด artist เพื่อ weight ในการ extend ถัดไป
    if (user.radio && user.queue.current) {
      const artist = user.queue.current.track.artist;
      if (!user.radio.playedArtists.includes(artist)) {
        user.radio.playedArtists.push(artist);
      }
    }
    recordPlaybackEnd(user, userId, "completed");
    let played = queueAdvance(user.queue, "completed", user.settings!.repeatMode);
    // queue.md §5 4b — เพลงสุดท้ายจบ + autoplay → เติมเพลงใหม่ต่อทันที (gap = 1 round trip)
    if (!played && (await autoplayRefill(user, userId, trackId))) {
      played = user.queue.current;
    }
    if (!played) {
      emitQueueEnded(user, userId);
      await persist(user, userId);
      return { ended: true };
    }
    user.version += 1;
    optimisticPlay(user, played.track);
    await persist(user, userId);
    emitTrackStarted(user, userId);
    return { ended: true };
  }

  /**
   * TRACK_STALLED — server นับต่อ user ในหน้าต่าง 30 s; ครบ 3 → TRACK_EXCEPTION + advance
   * (advance ใช้ reason "skip" — เสียงยังไม่เคยเล่นจึงไม่นับเป็น completed)
   */
  async function reportStalled(
    userId: string,
    trackId: string,
    now = Date.now(),
  ): Promise<{ exception: boolean }> {
    const user = await getUser(userId);
    if (user.queue.current?.track.id !== trackId) return { exception: false };
    user.stalls = user.stalls.filter((t) => now - t < STALL_WINDOW_MS);
    user.stalls.push(now);
    if (user.stalls.length < STALL_THRESHOLD) return { exception: false };
    user.stalls = [];
    const seedTrackId = user.queue.current?.track.id ?? null;
    recordPlaybackEnd(user, userId, "skip");
    const current = itemDto(user);
    emit(userId, RealtimeEvents.TrackException, {
      item: current,
      code: "SOURCE_ERROR",
      message: "เล่นเพลงนี้ไม่ได้ — เดินหน้าต่ออัตโนมัติ",
    });
    let played = queueAdvance(user.queue, "skip", user.settings!.repeatMode);
    if (!played && (await autoplayRefill(user, userId, seedTrackId))) {
      played = user.queue.current;
    }
    if (!played) {
      emitQueueEnded(user, userId);
      await persist(user, userId);
      return { exception: true };
    }
    user.version += 1;
    optimisticPlay(user, played.track);
    await persist(user, userId);
    emitTrackStarted(user, userId);
    return { exception: true };
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
    setAutoplay,
    startRadio,
    extendRadio,
    addToQueue,
    addNextToQueue,
    removeQueueItem,
    moveQueueItem,
    clear,
    syncPosition,
    reportTrackEnded,
    reportStalled,
  };
}

export type PlayerService = ReturnType<typeof createPlayerService>;
