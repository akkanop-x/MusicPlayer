import { describe, expect, it } from "vitest";
import type { TrackDTO } from "./types.js";
import {
  addNext,
  addTracks,
  advance,
  clearQueue,
  emptyQueue,
  makeQueueItem,
  moveInUpcoming,
  playNow,
  previous,
  removeFromUpcoming,
  setShuffle,
  type QueueModel,
} from "./queueLogic.js";

let seq = 0;
function track(name: string): TrackDTO {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    title: name,
    artist: "Artist",
    album: null,
    durationMs: 200_000,
    isStream: false,
    isSeekable: true,
    artworkUrl: null,
    sourceName: "youtube",
    isLiked: false,
  };
}
function item(model: QueueModel, name: string) {
  return makeQueueItem(track(name), model.upcoming.length + model.history.length + seq);
}
/** rng แบบ deterministic สำหรับ test shuffle */
function seqRng(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("queueLogic — add/remove/move/clear", () => {
  it("add เพิ่มท้าย — track ซ้ำ 10 ชิ้นก็ได้ 10 items (คนละ id)", () => {
    const model = emptyQueue();
    const t = track("Same");
    const items = Array.from({ length: 10 }, (_, i) => makeQueueItem(t, i));
    addTracks(model, items);
    expect(model.upcoming).toHaveLength(10);
    expect(new Set(model.upcoming.map((i) => i.id)).size).toBe(10);
  });

  it("addNext แทรกหน้าสุด", () => {
    const model = emptyQueue();
    addTracks(model, [item(model, "A"), item(model, "B")]);
    addNext(model, item(model, "NEXT"));
    expect(model.upcoming.map((i) => i.track.title)).toEqual(["NEXT", "A", "B"]);
  });

  it("remove เฉพาะ upcoming — current/history ไม่ถูกแตะ", () => {
    const model = emptyQueue();
    model.current = item(model, "CUR");
    addTracks(model, [item(model, "A"), item(model, "B")]);
    model.history = [item(model, "OLD")];
    expect(removeFromUpcoming(model, model.upcoming[0]!.id)).toBe(true);
    expect(model.upcoming.map((i) => i.track.title)).toEqual(["B"]);
    expect(model.current?.track.title).toBe("CUR");
    expect(model.history.map((i) => i.track.title)).toEqual(["OLD"]);
    expect(removeFromUpcoming(model, "ไม่มีจริง")).toBe(false);
  });

  it("move ย้ายภายใน upcoming + clamp ขอบเขต", () => {
    const model = emptyQueue();
    addTracks(model, [item(model, "A"), item(model, "B"), item(model, "C")]);
    expect(moveInUpcoming(model, model.upcoming[2]!.id, 0)).toBe(true);
    expect(model.upcoming.map((i) => i.track.title)).toEqual(["C", "A", "B"]);
    expect(moveInUpcoming(model, model.upcoming[0]!.id, 999)).toBe(true);
    expect(model.upcoming.map((i) => i.track.title)).toEqual(["A", "B", "C"]);
    expect(moveInUpcoming(model, "nope", 0)).toBe(false);
  });

  it("clear upcoming คง current/history; clear all ล้างหมด", () => {
    const model = emptyQueue();
    model.current = item(model, "CUR");
    addTracks(model, [item(model, "A")]);
    model.history = [item(model, "OLD")];
    clearQueue(model, "upcoming");
    expect(model.upcoming).toEqual([]);
    expect(model.current?.track.title).toBe("CUR");
    expect(model.history).toHaveLength(1);
    clearQueue(model, "all");
    expect(model.current).toBeNull();
    expect(model.history).toEqual([]);
  });
});

describe("queueLogic — shuffle/unshuffle", () => {
  it("shuffle สลับลำดับแสดงผล, unshuffle คืนตาม originalPosition, current/history ไม่ถูกแตะ", () => {
    const model = emptyQueue();
    model.current = item(model, "CUR");
    const items = [
      item(model, "A"),
      item(model, "B"),
      item(model, "C"),
      item(model, "D"),
    ];
    addTracks(model, items);
    const beforeHistory = [...model.history];

    setShuffle(model, true, { rng: seqRng([0.999, 0.999, 0.999]) }); // j=i ทุกครั้ง → ลำดับเดิม
    expect(model.upcoming.map((i) => i.track.title)).toEqual(["A", "B", "C", "D"]);
    expect(model.shuffleOrder).not.toBeNull();

    setShuffle(model, true, { rng: seqRng([0.9, 0.9, 0.9]) }); // สลับหนัก ๆ
    expect(
      [...model.upcoming]
        .sort((a, b) => a.track.title.localeCompare(b.track.title))
        .map((i) => i.track.title),
    ).toEqual(["A", "B", "C", "D"]);
    expect(model.current?.track.title).toBe("CUR");
    expect(model.history).toEqual(beforeHistory);

    // mutate ระหว่าง shuffle แล้ว unshuffle → คืนตาม originalPosition (NEW ถูกเพิ่มทีหลัง = op มากสุด)
    removeFromUpcoming(model, model.upcoming[0]!.id);
    addNext(model, item(model, "NEW"));
    setShuffle(model, false);
    expect(model.upcoming.map((i) => i.track.title)).toEqual(["B", "C", "D", "NEW"]);
  });
});

describe("queueLogic — advance (queue.md §5)", () => {
  it("advance: current → history, upcoming.shift → current", () => {
    const model = emptyQueue();
    addTracks(model, [item(model, "A"), item(model, "B"), item(model, "C")]);
    const first = advance(model, "completed", "off");
    expect(first?.track.title).toBe("A");
    expect(model.current?.track.title).toBe("A");
    expect(model.history).toEqual([]);
    advance(model, "completed", "off");
    expect(model.history.map((i) => i.track.title)).toEqual(["A"]);
    expect(model.current?.track.title).toBe("B");
  });

  it("repeat=one + completed → replay โดยไม่ push history; skip ยัง advance ปกติ", () => {
    const model = emptyQueue();
    addTracks(model, [item(model, "A"), item(model, "B")]);
    advance(model, "completed", "off"); // → A
    const replayed = advance(model, "completed", "one");
    expect(replayed?.track.title).toBe("A");
    expect(model.history).toEqual([]);
    const skipped = advance(model, "skip", "one");
    expect(skipped?.track.title).toBe("B"); // skip = เจตนาผู้ใช้ → ไปตัวถัดไป
    expect(model.history.map((i) => i.track.title)).toEqual(["A"]);
  });

  it("repeat=all สร้างรอบใหม่จาก round (A→B→C→A→B→C…)", () => {
    const model = emptyQueue();
    addTracks(model, [item(model, "A"), item(model, "B"), item(model, "C")]);
    expect(advance(model, "completed", "all")?.track.title).toBe("A");
    expect(advance(model, "completed", "all")?.track.title).toBe("B");
    expect(advance(model, "completed", "all")?.track.title).toBe("C");
    // upcoming ว่าง → สร้างรอบใหม่
    expect(advance(model, "completed", "all")?.track.title).toBe("A");
    expect(model.upcoming.map((i) => i.track.title)).toEqual(["B", "C"]);
    expect(advance(model, "completed", "all")?.track.title).toBe("B");
    expect(advance(model, "completed", "all")?.track.title).toBe("C");
    expect(advance(model, "completed", "all")?.track.title).toBe("A");
  });

  it("repeat=all กับ queue 1 เพลง = วนไม่รู้จบ", () => {
    const model = emptyQueue();
    addTracks(model, [item(model, "SOLO")]);
    for (let i = 0; i < 3; i++) {
      expect(advance(model, "completed", "all")?.track.title).toBe("SOLO");
    }
  });

  it("repeat=off + upcoming ว่าง → null (ENDED → IDLE)", () => {
    const model = emptyQueue();
    addTracks(model, [item(model, "A")]);
    advance(model, "completed", "off");
    expect(advance(model, "completed", "off")).toBeNull();
    expect(model.current).toBeNull();
  });

  it("history ถูก cap ที่ 100", () => {
    const model = emptyQueue();
    for (let i = 0; i < 120; i++) {
      addTracks(model, [item(model, `T${i}`)]);
      advance(model, "completed", "off");
    }
    expect(model.history).toHaveLength(100);
  });
});

describe("queueLogic — previous (queue.md §6, ตัวอย่าง A→D→B→C)", () => {
  it("เดินหน้า A→D→B→C แล้ว previous ที่ C = B, อีก = D, อีก = A", () => {
    const model = emptyQueue();
    playNow(model, item(model, "A")); // current=A, upcoming=[] (play now แทนที่ upcoming)
    addNext(model, item(model, "D")); // upcoming=[D]
    addTracks(model, [item(model, "B"), item(model, "C")]); // upcoming=[D,B,C] → walk A→D→B→C

    expect(advance(model, "skip", "off")?.track.title).toBe("D"); // A→history, D=current
    expect(advance(model, "skip", "off")?.track.title).toBe("B");
    expect(advance(model, "skip", "off")?.track.title).toBe("C");
    expect(model.history.map((i) => i.track.title)).toEqual(["B", "D", "A"]);

    expect(previous(model)?.track.title).toBe("B"); // C กลับ upcoming
    expect(model.upcoming[0]?.track.title).toBe("C");
    expect(previous(model)?.track.title).toBe("D");
    expect(previous(model)?.track.title).toBe("A");
    expect(previous(model)).toBeNull(); // history หมด → no-op
  });

  it("previous ทำงานถูกแม้กำลัง shuffle (history ไม่เคยถูกสลับ)", () => {
    const model = emptyQueue();
    playNow(model, item(model, "A"));
    addTracks(model, [item(model, "B"), item(model, "C")]);
    setShuffle(model, true, { rng: seqRng([0.0, 0.0]) }); // สลับ → upcoming [C,B]
    expect(model.upcoming.map((i) => i.track.title)).toEqual(["C", "B"]);
    // เดินหน้า A→C→B
    expect(advance(model, "skip", "off")?.track.title).toBe("C");
    expect(advance(model, "skip", "off")?.track.title).toBe("B");
    // ย้อนกลับ: history ต้องตาม path จริงแม้ upcoming ถูกสลับ (current ถูกดันกลับ upcoming หน้าสุด)
    expect(previous(model)?.track.title).toBe("C");
    expect(model.upcoming[0]?.track.title).toBe("B"); // B (current เดิม) กลับมาเล่นถัดไป
    expect(previous(model)?.track.title).toBe("A");
    expect(previous(model)).toBeNull();
  });
});

describe("queueLogic — playNow", () => {
  it("play now: current เดิม → history, upcoming ถูกแทนที่, roundStart รีเซ็ต", () => {
    const model = emptyQueue();
    addTracks(model, [item(model, "X"), item(model, "Y")]);
    playNow(model, item(model, "NEW"));
    expect(model.current?.track.title).toBe("NEW");
    expect(model.upcoming).toEqual([]);
    expect(model.history).toEqual([]);
    expect(model.roundStartId).toBe(model.current!.id);
  });
});
