/**
 * Queue logic — queue.md §1–§6 (pure functions ไม่พึ่ง DOM/network/db)
 * model ต่อ user: current + upcoming + history (ใหม่→เก่า) + repeatMode
 * shuffle ทำกับ "ลำดับแสดงผล" ของ upcoming เท่านั้น — ทุก item เก็บ originalPosition
 * เพื่อ unshuffle คืนลำดับเดิมได้แม้จะมีการ add/remove/move ระหว่าง shuffle
 */
import type { RepeatMode } from "./playerState.js";
import type { TrackDTO } from "./types.js";

/** เหตุผลของ advance: เพลงจบเอง (completed) หรือผู้ใช้กด skip */
export type AdvanceReason = "completed" | "skip";

export const QUEUE_HISTORY_CAP = 100;

/** ชิ้นเดียวใน queue — id สุ่มต่อชิ้น: track ซ้ำได้ (ไม่ dedupe) และ remove/move อ้างด้วย id */
export interface QueueItem {
  id: string;
  track: TrackDTO;
  /** ลำดับเดิมตอนถูกเพิ่ม (monotonic ต่อ user) — unshuffle ใช้อันนี้คืนลำดับ */
  originalPosition: number;
}

export interface QueueModel {
  current: QueueItem | null;
  upcoming: QueueItem[];
  /** ใหม่→เก่า: history[0] = เพลงที่เพิ่งเล่นจบ/ข้าม */
  history: QueueItem[];
  /** null = ไม่ได้ shuffle; อื่น ๆ = permutation ของลำดับแสดงผล (queue.md §4) */
  shuffleOrder: number[] | null;
  /** id ของ item แรกใน "รอบ" ปัจจุบัน — repeat=all ใช้สร้างรอบใหม่ (queue.md §5.4a) */
  roundStartId: string | null;
}

export function emptyQueue(): QueueModel {
  return {
    current: null,
    upcoming: [],
    history: [],
    shuffleOrder: null,
    roundStartId: null,
  };
}

export function makeQueueItem(
  track: TrackDTO,
  originalPosition: number,
  id = randomId(),
): QueueItem {
  return { id, track, originalPosition };
}

/** id generator แยกออกมาเพื่อให้ test กำหนดเองได้ (inject ผ่าน makeQueueItem ก็ได้) */
export function randomId(): string {
  return globalThis.crypto.randomUUID();
}

// ---------- เพิ่ม/ลบ/ย้าย ----------

/** add(trackIds) — ต่อท้าย; ถ้ากำลัง shuffle → แทรกตำแหน่งสุ่ม (queue.md §4) */
export function addTracks(
  model: QueueModel,
  items: QueueItem[],
  opts: { rng?: () => number } = {},
): void {
  const rng = opts.rng ?? Math.random;
  let upcoming = model.upcoming;
  for (const item of items) {
    if (model.shuffleOrder !== null) {
      const at = Math.floor(rng() * (upcoming.length + 1));
      upcoming = [...upcoming.slice(0, at), item, ...upcoming.slice(at)];
    } else {
      upcoming = [...upcoming, item];
    }
  }
  model.upcoming = upcoming;
}

/** addNext — แทรกหน้าสุดของลำดับแสดงผล (ตำแหน่ง 0 เสมอ แม้ shuffle) */
export function addNext(model: QueueModel, item: QueueItem): void {
  model.upcoming = [item, ...model.upcoming];
}

/** remove จาก upcoming เท่านั้น — คืน false ถ้าไม่เจอ; current/history ห้ามแตะ (queue.md §2) */
export function removeFromUpcoming(model: QueueModel, itemId: string): boolean {
  const index = model.upcoming.findIndex((i) => i.id === itemId);
  if (index === -1) return false;
  model.upcoming = model.upcoming.filter((i) => i.id !== itemId);
  return true;
}

/** move ภายใน upcoming — toPosition คือตำแหน่งในลำดับแสดงผล; คืน false ถ้า id ไม่เจอ */
export function moveInUpcoming(
  model: QueueModel,
  itemId: string,
  toPosition: number,
): boolean {
  const from = model.upcoming.findIndex((i) => i.id === itemId);
  if (from === -1) return false;
  const clamped = Math.min(Math.max(toPosition, 0), model.upcoming.length - 1);
  const next = [...model.upcoming];
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item!);
  model.upcoming = next;
  return true;
}

/** clear — scope upcoming (ค่าเริ่ม) หรือ all (upcoming+history+current → IDLE) */
export function clearQueue(model: QueueModel, scope: "upcoming" | "all"): void {
  model.upcoming = [];
  model.shuffleOrder = null;
  if (scope === "all") {
    model.history = [];
    model.current = null;
    model.roundStartId = null;
  }
}

// ---------- shuffle ----------

/** เปิด shuffle: สลับลำดับแสดงผลของ upcoming (Fisher–Yates); ปิด: คืนตาม originalPosition */
export function setShuffle(
  model: QueueModel,
  enabled: boolean,
  opts: { rng?: () => number } = {},
): void {
  if (!enabled) {
    model.shuffleOrder = null;
    model.upcoming = [...model.upcoming].sort(
      (a, b) => a.originalPosition - b.originalPosition,
    );
    return;
  }
  const rng = opts.rng ?? Math.random;
  const next = [...model.upcoming];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  model.upcoming = next;
  model.shuffleOrder = next.map((_, i) => i);
}

// ---------- advance / previous ----------

/**
 * advance (queue.md §5) — เล่นเพลงถัดไป; คืน item ที่ควรเล่น (null = จบ queue → IDLE)
 * 1. repeat=one + completed → replay current (ไม่ push history ซ้ำ)
 * 2. current → history (cap 100)
 * 3. upcoming มี → shift เป็น current
 * 4. upcoming ว่าง: repeat=all → สร้างรอบใหม่จาก history ถึง roundStart; ไม่งั้น → null (ENDED)
 *    (skip บน repeat=one ยัง advance ปกติ — เจตนาผู้ใช้)
 * หมายเหตุ autoplay/radio refill: Phase 11 (RecommendationService) — hook จุดนี้
 */
export function advance(
  model: QueueModel,
  reason: AdvanceReason,
  repeatMode: RepeatMode,
): QueueItem | null {
  if (reason === "completed" && repeatMode === "one" && model.current) {
    return model.current; // replay — ไม่แตะ history
  }
  if (model.current) {
    model.history = [model.current, ...model.history].slice(0, QUEUE_HISTORY_CAP);
  }
  const next = model.upcoming.shift();
  if (next) {
    model.current = next;
    return next;
  }
  if (repeatMode === "all" && model.current && model.history.length > 0) {
    const rebuilt = rebuildRound(model);
    if (rebuilt) return rebuilt;
  }
  model.current = null;
  return null;
}

/** repeat=all: ดึง history รอบปัจจุบัน (ถึง roundStart) กลับเป็น upcoming เรียงเดิม */
function rebuildRound(model: QueueModel): QueueItem | null {
  const stopIndex = model.roundStartId
    ? model.history.findIndex((i) => i.id === model.roundStartId)
    : model.history.length - 1;
  if (stopIndex === -1) return null;
  const round = model.history.slice(0, stopIndex + 1).reverse(); // เรียงเดิม (เก่า→ใหม่)
  model.upcoming = round;
  model.roundStartId = round[0]!.id;
  model.history = model.history.slice(stopIndex + 1);
  const next = model.upcoming.shift()!;
  model.current = next;
  return next;
}

/**
 * previous (queue.md §6) — คืน item ที่ควรเล่น (null = ไม่มี history; caller เริ่มที่ 0 เสมอ)
 * การ "restart current เมื่อ position > 3 s" เป็นหน้าที่ caller (client รู้ position — Phase 4 lesson)
 */
export function previous(model: QueueModel): QueueItem | null {
  const [item, ...rest] = model.history;
  if (!item) return null;
  model.history = rest;
  if (model.current) {
    model.upcoming = [model.current, ...model.upcoming];
  }
  model.current = item;
  return item;
}

/** ตั้ง current ใหม่ (play now — api.md §4 #10: แทนที่ upcoming) */
export function playNow(model: QueueModel, item: QueueItem): QueueItem {
  if (model.current) {
    model.history = [model.current, ...model.history].slice(0, QUEUE_HISTORY_CAP);
  }
  model.upcoming = []; // play now = แทนที่ upcoming (Spotify behavior)
  model.shuffleOrder = null;
  model.current = item;
  model.roundStartId = item.id;
  return item;
}
