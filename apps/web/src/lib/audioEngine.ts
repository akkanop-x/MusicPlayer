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
  initialPlayerContext,
  shouldAutoAdvance,
  transition,
  type PlayerContext,
  type TrackDTO,
} from "@musicplayer/shared";
import { playerApi } from "../api";
import {
  useIntentStore,
  usePlayerStore,
  useProgressStore,
  useToastStore,
} from "../stores/playerStore";

export class AudioEngine {
  private audio: HTMLAudioElement;
  private ctx: PlayerContext = initialPlayerContext();
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  /** generation counter — คำสั่ง play ที่ใหม่กว่ายกเลิกผลของอันเก่า (#1/#2) */
  private playSeq = 0;
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
      this.mediaSource.connect(this.gainNode).connect(this.audioCtx.destination);
      const { volume } = usePlayerStore.getState();
      this.gainNode.gain.value = volume / 100;
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

  // ---------- คำสั่ง ----------
  /** play track ใหม่ (หรือ restart track เดิม) — เรียกได้ถี่แค่ไหนก็ได้ (#1/#2) */
  async play(track: TrackDTO): Promise<void> {
    this.ensureAudioGraph();
    const seq = ++this.playSeq;
    // #1/#2: ตัด session เดิมทิ้งก่อน — element เดียว = เสียงเก่าหยุดทันที
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();

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

    this.ctx = transition(this.ctx, { type: "LOAD", trackId: track.id });
    usePlayerStore.getState().setStateDto(dto);
    this.audio.src = this.streamUrl(track.id);
    this.audio.volume = dto.muted ? 0 : dto.volume / 100;
    // server ตอบ PLAYING แบบ optimistic (player.md §4) — เสียงจริงยืนยันด้วย canplay/playing
    if (dto.state === "PAUSED") {
      this.ctx = transition(this.ctx, { type: "PAUSE", positionMs: 0 });
    }
    void this.audio.play().catch(() => undefined);
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
  }

  async resume(): Promise<void> {
    this.ensureAudioGraph();
    const dto = await playerApi.resume().catch((error) => {
      useToastStore.getState().show(String((error as Error).message));
      return null;
    });
    if (!dto) return;
    usePlayerStore.getState().setStateDto(dto);
    this.ctx = transition(this.ctx, { type: "PLAYING" });
    void this.audio.play().catch(() => undefined);
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
    void this.audio.play().catch(() => undefined);
  }

  async skip(): Promise<void> {
    try {
      const queue = await playerApi.skip();
      if (queue.current) await this.play(queue.current);
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
      if (dto.track) await this.play(dto.track);
    } catch (error) {
      useToastStore.getState().show(String((error as Error).message));
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
      state: usePlayerStore.getState().state,
      track: usePlayerStore.getState().track,
      positionMs: usePlayerStore.getState().positionMs,
      repeatMode: usePlayerStore.getState().repeatMode,
      shuffle: usePlayerStore.getState().shuffle,
      autoplay: usePlayerStore.getState().autoplay,
    });
    void playerApi.setVolume(volume).catch(() => undefined);
  }

  setRepeat(mode: "off" | "one" | "all"): void {
    void playerApi
      .setRepeat(mode)
      .then((dto) => usePlayerStore.getState().setStateDto(dto))
      .catch(() => undefined);
  }

  // ---------- events ปลายทาง ----------
  private async handleEnded(): Promise<void> {
    const { repeatMode } = usePlayerStore.getState();
    if (repeatMode === "one") {
      await this.skip(); // repeat one → skip วนเพลงเดิม (server จัดการ)
      return;
    }
    // Phase 4: mock queue 1 เพลง — ไม่มี upcoming → จบกลับ IDLE
    this.ctx = transition(this.ctx, { type: "STOP" });
    usePlayerStore.getState().patchState({ state: "IDLE" });
    useIntentStore.getState().setPendingTrack(null);
  }

  /** #4: error → auto-advance ผ่าน server skip; ครบ 3 ติด → IDLE + toast */
  private async handleError(): Promise<void> {
    if (shouldAutoAdvance(this.ctx)) {
      try {
        const queue = await playerApi.skip();
        if (queue.current) {
          await this.play(queue.current);
          return;
        }
      } catch {
        // NO_NEXT → ตกไปทางขวาล่าง: หยุด + toast
      }
    }
    this.ctx = transition(this.ctx, { type: "STOP" });
    usePlayerStore.getState().patchState({ state: "IDLE" });
    useIntentStore.getState().setPendingTrack(null);
    useToastStore.getState().show("เล่นเพลงไม่สำเร็จ — ลองเพลงอื่นดูนะ");
  }

  /** ดึง state จาก server ตอน boot (player.md #7 — refresh แล้วเห็นสถานะเดิมเป็นอย่างน้อย) */
  async syncFromServer(): Promise<void> {
    try {
      const dto = await playerApi.getState();
      usePlayerStore.getState().setStateDto(dto);
    } catch {
      // ยังไม่ล็อกอิน — ไม่เป็นไร
    }
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
