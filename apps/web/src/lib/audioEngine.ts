/**
 * AudioEngine — player.md §6/§8 + ADR-005
 * <audio> element เดียวต่อ page → /api/v1/stream/:trackId (auth ด้วย session cookie)
 * state ทั้งหมดผ่าน packages/shared/playerState (machine เดียวกับ server)
 *
 * Edge cases (player.md §5) ที่จัดการตรงนี้:
 * - #1/#2 play/skip ถี่ ๆ ตอน LOADING: element เดียวเสมอ + ตัด src เดิมทิ้งก่อนโหลดใหม่ → เสียงซ้อนไม่มีทางเกิด
 * - #3 pause ตอน LOADING → pauseWhenReady → pause ทันทีที่ canplay
 * - #4 track error → auto-advance (ผ่าน server skip) จนครบ 3 ติด → IDLE + toast
 * - #8 AudioContext suspended → สร้าง/ต่อ Web Audio graph หลัง first gesture เท่านั้น
 */
import {
  EQ_BAND_COUNT,
  initialPlayerContext,
  shouldAutoAdvance,
  transition,
  type PlayerContext,
  type PlayerStateDTO,
  type PlayerStateChangedPayload,
  type TrackDTO,
  type TrackStartedPayload,
} from "@musicplayer/shared";
import { playerApi, queueApi } from "../api";
import i18next from "../i18n";
import { createEqFilters } from "./eqGraph";
import {
  isRealtimeConnected,
  positionSync,
  reportStalled,
  reportTrackEnded,
} from "../realtime/socketClient";
import {
  useIntentStore,
  usePlayerStore,
  useProgressStore,
  useQueueStore,
  useToastStore,
} from "../stores/playerStore";

export class AudioEngine {
  private audio: HTMLAudioElement;
  private ctx: PlayerContext = initialPlayerContext();
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  /** EQ chain (equalizer.md §1) — สร้างครั้งเดียวพร้อม graph, เปลี่ยนแค่ gain ของ filter */
  private eqFilters: BiquadFilterNode[] = [];
  /** ค่า EQ ล่าสุด — graph ยังไม่เกิด (ยังไม่มี gesture) → apply ตอนสร้าง (equalizer.md §5) */
  private pendingEqBands: number[] | null = null;
  /** generation counter — คำสั่ง play ที่ใหม่กว่ายกเลิกผลของอันเก่า (#1/#2) */
  private playSeq = 0;
  /** generation counter ของ refreshQueue — กัน response เก่าทับ queue ใหม่ */
  private refreshSeq = 0;
  /** ครั้งล่าสุดที่ส่ง POSITION_SYNC (websocket.md §4: ทุก 5 s ขณะเล่น) */
  private lastSyncSentAt = 0;
  /** จำนวน STALLED report ของ track ปัจจุบัน (server นับหน้าต่าง 30 s เองอีกชั้น) */
  private stallAttempts = 0;
  /** expose เพื่อ test (element เดียวเสมอ — ห้ามสร้าง <audio> ที่ไหนอื่น) */
  get element(): HTMLAudioElement {
    return this.audio;
  }

  private streamUrl(trackId: string): string {
    return `/api/v1/stream/${trackId}`;
  }

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    // แปะ DOM (ซ่อนไว้) — ตรวจ "element เดียว/ไม่มีเสียงซ้อน" จากภายนอกได้ + ช่วย autoplay policy
    this.audio.style.display = "none";
    document.body.append(this.audio);
    this.bindMediaEvents();
  }

  /** hook ตอน first user gesture (edge #8) — สร้าง graph ครั้งเดียวต่อ page load */
  ensureAudioGraph(): void {
    if (this.audioCtx) {
      if (this.audioCtx.state === "suspended") void this.audioCtx.resume();
      return;
    }
    try {
      this.audioCtx = new AudioContext();
      this.mediaSource = this.audioCtx.createMediaElementSource(this.audio);
      this.gainNode = this.audioCtx.createGain();
      // equalizer.md §1: MediaElementSource → EQ ×10 → Gain(volume) → Compressor(−6 dB) → out
      this.eqFilters = createEqFilters(this.audioCtx);
      this.mediaSource.connect(this.eqFilters[0]!);
      for (let i = 0; i < this.eqFilters.length - 1; i += 1) {
        this.eqFilters[i]!.connect(this.eqFilters[i + 1]!);
      }
      this.eqFilters[this.eqFilters.length - 1]!.connect(this.gainNode);
      // compressor = default safety กัน clip เมื่อหลาย band บวกพร้อมกัน (equalizer.md §7)
      const compressor = this.audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -6;
      this.gainNode.connect(compressor).connect(this.audioCtx.destination);
      const { volume } = usePlayerStore.getState();
      this.gainNode.gain.value = volume / 100;
      const bands = this.pendingEqBands;
      if (bands) this.applyEq(bands);
    } catch {
      // ถ้า Web Audio ใช้ไม่ได้ เสียงยังออกผ่าน element โดยตรง
      this.audioCtx = null;
    }
  }

  // ---------- media events → state machine ----------
  private bindMediaEvents(): void {
    const audio = this.audio;
    const stores = () => ({
      player: usePlayerStore.getState(),
      progress: useProgressStore.getState(),
    });

    audio.addEventListener("loadedmetadata", () => {
      const { progress } = stores();
      progress.setProgress(
        Math.round(audio.currentTime * 1000),
        Math.round(audio.duration * 1000),
      );
    });
    audio.addEventListener("canplay", () => {
      if (!audio.src) return; // element ว่าง (เพิ่ง reload) — ห้ามขับ state machine
      // #3: มี intent pause ค้างจากตอน LOADING → หยุดทันทีที่พร้อม
      if (this.ctx.pauseWhenReady) {
        audio.pause();
        return;
      }
      this.ctx = transition(this.ctx, {
        type: "CANPLAY",
        durationMs: Math.round((audio.duration || 0) * 1000),
      });
      this.ctx = transition(this.ctx, { type: "PLAYING" });
      void audio.play().catch(() => undefined);
      stores().player.patchState({ state: this.ctx.state });
    });
    audio.addEventListener("playing", () => {
      if (!audio.src) return;
      this.ctx = transition(this.ctx, { type: "PLAYING" });
      stores().player.patchState({ state: this.ctx.state });
    });
    audio.addEventListener("pause", () => {
      if (this.ctx.state === "LOADING") return; // การ pause ตอนโหลดเป็นการ internal (#3)
      this.ctx = transition(this.ctx, {
        type: "PAUSE",
        positionMs: this.currentPositionMs(),
      });
      stores().player.patchState({
        state: this.ctx.state,
        positionMs: this.ctx.positionMs,
      });
    });
    audio.addEventListener("waiting", () => {
      if (!audio.src) return; // จาก E2E J6: empty element ยังยิง waiting → BUFFERING ปลอม
      this.ctx = transition(this.ctx, {
        type: "WAITING",
        positionMs: this.currentPositionMs(),
      });
      stores().player.patchState({ state: "BUFFERING" });
    });
    audio.addEventListener("seeked", () => {
      this.ctx = transition(this.ctx, {
        type: "SEEKED",
        positionMs: this.currentPositionMs(),
      });
      stores().player.patchState({ positionMs: this.ctx.positionMs });
      // player.md §8: อย่าอัปเดต progress ก่อน seeked — หลังจากนี้ค่อย sync ต่อ
      stores().progress.setProgress(
        this.ctx.positionMs,
        Math.round((audio.duration || 0) * 1000),
      );
    });
    audio.addEventListener("timeupdate", () => {
      const durationMs = Math.round((audio.duration || 0) * 1000);
      // sync position กลับเข้า state machine — previous ใช้ตัดสิน restart vs pop history
      this.ctx.positionMs = this.currentPositionMs();
      stores().progress.setProgress(this.ctx.positionMs, durationMs);
      // websocket.md §4: client ส่ง POSITION_SYNC ทุก 5 s ขณะเล่น
      if (this.ctx.state === "PLAYING" && Date.now() - this.lastSyncSentAt > 5_000) {
        this.sendPositionSync();
      }
    });
    audio.addEventListener("stalled", () => {
      const track = usePlayerStore.getState().track;
      if (!track || !this.audio.src) return;
      if (this.ctx.state !== "PLAYING" && this.ctx.state !== "BUFFERING") return;
      this.stallAttempts += 1;
      void reportStalled(track.id, this.currentPositionMs(), this.stallAttempts);
    });
    audio.addEventListener("ended", () => {
      this.ctx = transition(this.ctx, { type: "ENDED" });
      void this.handleEnded();
    });
    audio.addEventListener("error", () => {
      this.ctx = transition(this.ctx, {
        type: "ERROR",
        positionMs: this.currentPositionMs(),
      });
      void this.handleError();
    });
  }

  private currentPositionMs(): number {
    return Math.round(this.audio.currentTime * 1000);
  }

  /** id ของ track ที่ audio element กำลังโหลด/เล่น (จาก src ปลายทาง) */
  private currentTrackId(): string | null {
    const last = this.audio.src.split("/").pop() ?? "";
    return last || null;
  }

  // ---------- คำสั่ง ----------
  /** play now (POST /player/play — แทนที่ upcoming) — เรียกได้ถี่แค่ไหนก็ได้ (#1/#2) */
  async play(track: TrackDTO): Promise<void> {
    this.ensureAudioGraph();
    const seq = ++this.playSeq;
    // #1/#2: ตัด session เดิมทิ้งก่อน — element เดียว = เสียงเก่าหยุดทันที
    this.teardownStream();

    useIntentStore.getState().setPendingTrack(track);
    const dto = await playerApi.play(track.id).catch((error) => {
      if (seq === this.playSeq) {
        useToastStore.getState().show(String((error as Error).message));
        useIntentStore.getState().setPendingTrack(null);
      }
      return null;
    });
    // มี play ใหม่สั่งระหว่างรอ server → ทิ้งผลของอันเก่า
    if (!dto || seq !== this.playSeq) return;

    usePlayerStore.getState().setStateDto(dto);
    // TRACK_STARTED broadcast อาจมาถึงก่อน REST response → src โหลดไปแล้ว ไม่ต้องรีโหลด
    if (this.currentTrackId() !== track.id) this.startStream(track, dto);
    void this.refreshQueue();
  }

  /**
   * เล่นทั้ง playlist ตามลำดับ (api.md #20) — ล้าง queue → เติม playlist → skip เริ่มเพลงแรก
   * ใช้ startStream เท่านั้น (ห้าม /player/play ซ้ำ — server จะล้าง upcoming ที่เพิ่งเติม)
   */
  async playPlaylist(playlistId: string): Promise<void> {
    this.ensureAudioGraph();
    const seq = ++this.playSeq;
    this.teardownStream();
    try {
      await queueApi.clear("all");
      const queue = await queueApi.addToPlaylist(playlistId);
      if (seq !== this.playSeq) return;
      useQueueStore.getState().setQueueDto(queue);
      if (!queue.upcoming[0]) {
        useToastStore.getState().show(i18next.t("playlist:empty"));
        return;
      }
      const started = await playerApi.skip();
      if (seq !== this.playSeq) return;
      useQueueStore.getState().setQueueDto(started);
      const current = started.current?.track ?? queue.upcoming[0].track;
      useIntentStore.getState().setPendingTrack(current);
      usePlayerStore.getState().patchState({ state: "PLAYING" });
      this.startStream(current, { ...usePlayerStore.getState(), state: "PLAYING" });
    } catch (error) {
      if (seq === this.playSeq) {
        useToastStore.getState().show(String((error as Error).message));
      }
    }
  }

  /**
   * โหลดเสียงของ track ที่ server ตั้งเป็น current แล้ว (skip/previous/advance ผ่าน
   * /player/skip — **ห้าม** ยิง /player/play ซ้ำ ไม่งั้น server จะ push history ซ้ำ
   * และล้าง upcoming — บั๊กจริงตอน smoke Phase 5)
   */
  private startStream(track: TrackDTO, dto?: PlayerStateDTO): void {
    this.ctx = transition(this.ctx, { type: "LOAD", trackId: track.id });
    this.stallAttempts = 0;
    const state = dto ?? usePlayerStore.getState();
    this.audio.src = this.streamUrl(track.id);
    this.audio.volume = state.muted ? 0 : state.volume / 100;
    // server ตอบ PLAYING แบบ optimistic (player.md §4) — เสียงจริงยืนยันด้วย canplay/playing
    if (state.state === "PAUSED") {
      this.ctx = transition(this.ctx, { type: "PAUSE", positionMs: 0 });
    }
    void this.audio.play().catch(() => undefined);
  }

  /** #1/#2: หยุด/ตัด stream เดิมก่อนโหลดใหม่ — element เดียว = เสียงซ้อนไม่มีทางเกิด */
  private teardownStream(): void {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  async pause(): Promise<void> {
    const dto = await playerApi.pause().catch(() => null);
    if (dto) usePlayerStore.getState().setStateDto(dto);
    // ระหว่าง LOADING → เก็บ intent ไว้ (#3); canplay จะ pause เอง
    if (this.ctx.state !== "LOADING") {
      this.ctx = transition(this.ctx, {
        type: "PAUSE",
        positionMs: this.currentPositionMs(),
      });
      this.audio.pause();
      usePlayerStore
        .getState()
        .patchState({ state: "PAUSED", positionMs: this.ctx.positionMs });
    }
    this.sendPositionSync();
  }

  async resume(): Promise<void> {
    this.ensureAudioGraph();
    const dto = await playerApi.resume().catch(async (error) => {
      // server restore snapshot เป็น PLAYING อยู่แล้ว → resume ตอบ NOT_PAUSED (409) แต่
      // client หลัง refresh ยังไม่มี src — ดึง state จริงมาโหลดสตรีมใหม่เอง (E2E J10)
      if (!this.audio.src) {
        const state = await playerApi.getState().catch(() => null);
        if (state?.track) return state;
      }
      useToastStore.getState().show(String((error as Error).message));
      return null;
    });
    if (!dto) return;
    usePlayerStore.getState().setStateDto(dto);
    this.ctx = transition(this.ctx, { type: "PLAYING" });
    // หลัง refresh src หาย (element ใหม่) — โหลดสตรีมใหม่แล้ว jump ไป position เดิม
    // (E2E J10 เจอบั๊กนี้: เคยแค่ audio.play() บน element ว่าง → เงียบตลอด)
    if (!this.audio.src && dto.track) {
      this.startStream(dto.track, dto);
      this.seekWhenReady(dto.positionMs);
      return;
    }
    void this.audio.play().catch(() => undefined);
  }

  /** ตั้ง currentTime หลังโหลด src — browser จะ seek เมื่อ metadata พร้อม */
  private seekWhenReady(positionMs: number): void {
    if (positionMs > 0 && Number.isFinite(positionMs)) {
      try {
        this.audio.currentTime = positionMs / 1000;
      } catch {
        // ยังไม่มี metadata — เริ่มที่ 0 แทน (edge หายาก)
      }
    }
  }

  /** player.md §8: UI จะรอ event `seeked` — ที่นี่แค่ตั้ง currentTime + เรียก server */
  async seek(positionMs: number): Promise<void> {
    const durationMs = useProgressStore.getState().durationMs;
    if (durationMs > 0) positionMs = Math.min(Math.max(positionMs, 0), durationMs - 1);
    try {
      const dto = await playerApi.seek(positionMs);
      usePlayerStore.getState().setStateDto(dto);
    } catch {
      // server reject (เช่น out of range) — ไม่ขยับเสียง
      return;
    }
    this.ctx = transition(this.ctx, { type: "SEEK", positionMs });
    this.audio.currentTime = positionMs / 1000;
    this.sendPositionSync();
    void this.audio.play().catch(() => undefined);
  }

  async skip(reason: "completed" | "skip" = "skip"): Promise<void> {
    try {
      const queue = await playerApi.skip(reason);
      useQueueStore.getState().setQueueDto(queue);
      if (queue.current?.track) {
        this.startStream(queue.current.track);
        return;
      }
      // advance คืน null = queue จบ (upcoming ว่าง, repeat off) → IDLE
      this.ctx = transition(this.ctx, { type: "STOP" });
      usePlayerStore.getState().patchState({ state: "IDLE" });
      useIntentStore.getState().setPendingTrack(null);
    } catch (error) {
      useToastStore.getState().show(String((error as Error).message));
    }
  }

  async previous(): Promise<void> {
    // player.md §3: เล่นเกิน 3 s → restart เพลงเดิม — client เป็นผู้รู้ position จริง
    // (ไม่มี WS ใน Phase 4 server จึงเก็บ positionMs = 0 เสมอ ตัดสินที่ server ไม่ได้)
    const track = usePlayerStore.getState().track;
    if (track && this.ctx.positionMs > 3_000) {
      await this.seek(0);
      return;
    }
    try {
      const dto = await playerApi.previous();
      if (dto.track) {
        this.startStream(dto.track, dto);
        void this.refreshQueue();
      }
    } catch (error) {
      useToastStore.getState().show(String((error as Error).message));
    }
  }

  /** ดึง queue ล่าสุดจาก server เข้า store — seq guard กัน response เก่าทับใหม่ (race) */
  async refreshQueue(): Promise<void> {
    const seq = ++this.refreshSeq;
    try {
      const queue = await queueApi.getQueue();
      if (seq === this.refreshSeq) useQueueStore.getState().setQueueDto(queue);
    } catch {
      // ยังไม่ล็อกอิน — ไม่เป็นไร
    }
  }

  setVolume(volume: number): void {
    const muted = volume === 0;
    this.audio.volume = muted ? 0 : volume / 100;
    if (this.gainNode) this.gainNode.gain.value = muted ? 0 : volume / 100;
    usePlayerStore.getState().setStateDto({
      ...usePlayerStore.getState(),
      volume,
      muted,
    });
    void playerApi.setVolume(volume).catch(() => undefined);
  }

  setRepeat(mode: "off" | "one" | "all"): void {
    void playerApi
      .setRepeat(mode)
      .then((dto) => usePlayerStore.getState().setStateDto(dto))
      .catch(() => undefined);
  }

  /** PATCH /player/shuffle — ตอบ QueueStateDTO (shuffle flag mirror ผ่าน optimistic + getState) */
  async setShuffle(enabled: boolean): Promise<void> {
    usePlayerStore.getState().patchState({ shuffle: enabled });
    try {
      const queue = await playerApi.setShuffle(enabled);
      useQueueStore.getState().setQueueDto(queue);
      const dto = await playerApi.getState();
      usePlayerStore.getState().setStateDto(dto);
    } catch (error) {
      useToastStore.getState().show(String((error as Error).message));
    }
  }

  // ---------- EQ (equalizer.md §3/§5) ----------
  /**
   * apply bands ที่ audio graph ทันที — null = Flat (zeros)
   * setTargetAtTime (timeConstant 0.05) เท่านั้น: เฟด exponential กัน click/pop
   * ตอนลาก slider ระหว่างเสียงเล่น — ห้ามเขียน .gain.value ตรง ๆ
   * graph ยังไม่เกิด (ยังไม่มี gesture) → เก็บไว้ apply ตอน ensureAudioGraph
   */
  applyEq(bands: number[] | null): void {
    const gains = bands ?? new Array<number>(EQ_BAND_COUNT).fill(0);
    this.pendingEqBands = bands;
    if (!this.audioCtx || this.eqFilters.length === 0) return;
    const now = this.audioCtx.currentTime;
    this.eqFilters.forEach((filter, i) => {
      filter.gain.setTargetAtTime(gains[i] ?? 0, now, 0.05);
    });
  }

  // ---------- events ปลายทาง ----------
  /**
   * เพลงจบเอง → ถ้า WS ต่ออยู่ รายงาน TRACK_ENDED ผ่าน WS (server advance + broadcast
   * TRACK_STARTED กลับมาเอง); ไม่ต่อ/timeout → fallback REST skip เดิม (websocket.md §5)
   */
  private async handleEnded(): Promise<void> {
    this.sendPositionSync();
    const track = usePlayerStore.getState().track;
    if (track && isRealtimeConnected()) {
      const res = await reportTrackEnded(track.id, this.ctx.positionMs);
      if (res?.ok) return;
    }
    await this.skip("completed");
  }

  /** #4: error → auto-advance ผ่าน server skip; ครบ 3 ติด → IDLE + toast */
  private async handleError(): Promise<void> {
    if (shouldAutoAdvance(this.ctx)) {
      try {
        const queue = await playerApi.skip("skip");
        if (queue.current) {
          this.startStream(queue.current.track);
          return;
        }
      } catch {
        // NO_NEXT → ตกไปทางขวาล่าง: หยุด + toast
      }
    }
    this.ctx = transition(this.ctx, { type: "STOP" });
    usePlayerStore.getState().patchState({ state: "IDLE" });
    useIntentStore.getState().setPendingTrack(null);
    useToastStore.getState().show(i18next.t("toast:playFailed"));
  }

  /** ดึง state จาก server ตอน boot (player.md #7 — refresh แล้วเห็นสถานะเดิมเป็นอย่างน้อย) */
  async syncFromServer(): Promise<void> {
    try {
      const dto = await playerApi.getState();
      // restore เป็น PLAYING แบบ optimistic แต่ browser ห้าม autoplay ตอนโหลดหน้า —
      // client จึงเล่นจริงไม่ได้: mirror เป็น PAUSED (กดเล่นต่อ = resume โหลด src ใหม่)
      const honest =
        dto.state === "PLAYING" ? { ...dto, state: "PAUSED" as const } : dto;
      usePlayerStore.getState().setStateDto(honest);
      await this.refreshQueue();
    } catch {
      // ยังไม่ล็อกอิน — ไม่เป็นไร
    }
  }

  // ---------- realtime: server → client (websocket.md §3) ----------

  /** POSITION_SYNC ออกจาก client (ทุก 5 s ขณะเล่น + ตอน pause/seek/ended) */
  private sendPositionSync(): void {
    this.lastSyncSentAt = Date.now();
    void positionSync(this.currentPositionMs());
    // ack ok:false → server emit POSITION_UPDATED กลับมา แล้ว applyRemotePosition จูนให้เอง
  }

  /** PLAYER_STATE_CHANGED จากอีก tab/อุปกรณ์ — ปรับเสียงให้ตรง (no-op ถ้าตรงกับสิ่งที่ tab นี้ทำอยู่) */
  applyRemotePlayerState(p: PlayerStateChangedPayload): void {
    const store = usePlayerStore.getState();
    store.setStateDto({
      ...store,
      state: p.state,
      track: p.track ?? store.track,
      positionMs: p.positionMs,
    });
    if (p.state === "PLAYING") {
      // เพลงใหม่ → รอ TRACK_STARTED จัดการโหลด (มาพร้อมกันเสมอ);
      // แต่ถ้า element ยังไม่มี src (เพิ่ง refresh — autoplay policy บล็อกการเล่นเอง)
      // server คิดว่าเล่นอยู่ไม่ได้จริง → mirror เป็น PAUSED พร้อม track/position
      // (กดเล่น = resume ซึ่งโหลด src ใหม่แล้ว jump ไป position เดิม)
      if (p.track && !this.audio.src) {
        store.setStateDto({
          ...store,
          state: "PAUSED",
          track: p.track,
          positionMs: p.positionMs,
        });
        return;
      }
      if (p.track && this.currentTrackId() !== p.track.id) return;
      if (this.audio.src && this.audio.paused) {
        this.ctx = transition(this.ctx, { type: "PLAYING" });
        void this.audio.play().catch(() => undefined);
      }
      return;
    }
    if (p.state === "PAUSED" || p.state === "IDLE") {
      if (this.ctx.state === "LOADING") {
        // ยังโหลดไม่เสร็จ — เก็บ intent ไว้ pause ทันทีที่ canplay (#3)
        this.ctx = { ...this.ctx, pauseWhenReady: true };
      } else if (!this.audio.paused) {
        this.audio.pause(); // media event 'pause' จะ transition ctx เอง
      }
      if (p.state === "IDLE") {
        this.ctx = transition(this.ctx, { type: "STOP" });
        this.teardownStream();
        useIntentStore.getState().setPendingTrack(null);
      }
    }
  }

  /** TRACK_STARTED — โหลดเสียงใหม่ (remote เริ่มเพลง / server advance หลัง ended/stalled) */
  applyTrackStarted(p: TrackStartedPayload): void {
    const track = p.item.track;
    const store = usePlayerStore.getState();
    store.setStateDto({ ...store, track, state: "PLAYING", positionMs: 0 });
    useIntentStore.getState().setPendingTrack(track);
    useProgressStore.getState().setProgress(0, track.durationMs);
    this.ctx.positionMs = 0;
    if (this.currentTrackId() === track.id) return; // tab ผู้สั่ง — โหลดอยู่แล้ว
    this.teardownStream();
    this.startStream(track);
  }

  /** POSITION_UPDATED — ขยับเฉพาะเมื่อต่างจาก local เกิน 500 ms (websocket.md §3) */
  applyRemotePosition(positionMs: number): void {
    if (!this.audio.src || !Number.isFinite(positionMs)) return;
    if (Math.abs(this.currentPositionMs() - positionMs) <= 500) return;
    this.audio.currentTime = positionMs / 1000;
    this.ctx.positionMs = positionMs;
    useProgressStore
      .getState()
      .setProgress(positionMs, Math.round((this.audio.duration || 0) * 1000));
  }

  /** VOLUME_CHANGED จากอีก tab/อุปกรณ์ */
  applyRemoteVolume(volume: number, muted: boolean): void {
    this.audio.volume = muted ? 0 : volume / 100;
    if (this.gainNode) this.gainNode.gain.value = muted ? 0 : volume / 100;
    const store = usePlayerStore.getState();
    store.setStateDto({ ...store, volume, muted });
  }
}

/** singleton — element เดียวต่อ page load (player.md §8) */
let engine: AudioEngine | null = null;
export function getAudioEngine(): AudioEngine {
  engine ??= new AudioEngine();
  return engine;
}

/** test-only — ทิ้ง singleton เพื่อให้แต่ละ test ได้ engine สะอาด */
export function _resetEngineForTests(): void {
  engine = null;
}
