/**
 * EQ graph tests — testing.md §3.5: ครบ 10 filter ตาม EQ_BANDS; applyEq ใช้
 * setTargetAtTime เท่านั้น (ห้าม .gain.value ตรง — equalizer.md §3 กัน click/pop);
 * graph ยังไม่เกิด → เก็บ pendingEqBands ไว้ apply ตอน ensureAudioGraph
 */
import { beforeEach, describe, expect, it } from "vitest";
import { EQ_BANDS } from "@musicplayer/shared";
import { createEqFilters } from "./eqGraph";
import { getAudioEngine, _resetEngineForTests } from "./audioEngine";

function makeParam(initial = 0) {
  const param = {
    setTargetAtTime: (v: number) => calls.push({ kind: "target", v }),
    setValueAtTime: (v: number) => calls.push({ kind: "setValueAtTime", v }),
  } as unknown as AudioParam & { value: number };
  const calls: Array<{ kind: string; v: number }> = [];
  let directSets = 0;
  let v = initial;
  Object.defineProperty(param, "value", {
    get: () => v,
    set: (x: number) => {
      v = x;
      directSets += 1;
    },
  });
  return { param, calls, directSets: () => directSets };
}

function makeFilter() {
  const freq = makeParam();
  const q = makeParam(1);
  const gain = makeParam();
  return {
    type: "",
    frequency: freq.param,
    Q: q.param,
    gain: gain.param,
    _freq: freq,
    _q: q,
    _gain: gain,
  };
}

type FakeFilter = ReturnType<typeof makeFilter>;

describe("createEqFilters", () => {
  it("10 filters — type/freq/Q ตรง EQ_BANDS, gain เริ่ม 0 (ยังไม่มีเสียง)", () => {
    const filters: FakeFilter[] = [];
    const ctx = {
      createBiquadFilter: () => {
        const f = makeFilter();
        filters.push(f);
        return f;
      },
    } as unknown as BaseAudioContext;
    const result = createEqFilters(ctx);
    expect(result).toHaveLength(10);
    for (const [i, band] of EQ_BANDS.entries()) {
      expect(filters[i]!.type).toBe(band.type);
      expect(filters[i]!.frequency.value).toBe(band.freq);
      expect(filters[i]!.Q.value).toBe(band.q);
      expect(filters[i]!.gain.value).toBe(0);
    }
  });
});

describe("AudioEngine.applyEq (equalizer.md §3)", () => {
  beforeEach(() => {
    _resetEngineForTests();
  });

  function engineWithGraph() {
    const engine = getAudioEngine();
    const filters: FakeFilter[] = Array.from({ length: 10 }, () => makeFilter());
    const engineInternal = engine as unknown as {
      audioCtx: { currentTime: number } | null;
      eqFilters: unknown[];
      pendingEqBands: number[] | null;
    };
    engineInternal.audioCtx = { currentTime: 1.25 };
    engineInternal.eqFilters = filters;
    return { engine, filters, engineInternal };
  }

  it("applyEq ยิง setTargetAtTime ครบ 10 ค่า (timeConstant 0.05) — ไม่มี .value ตรง", () => {
    const { engine, filters } = engineWithGraph();
    engine.applyEq([6, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(filters).toHaveLength(10);
    expect(filters[0]!._gain.calls).toEqual([{ kind: "target", v: 6 }]);
    for (const filter of filters) {
      expect(filter._gain.calls[0]!.kind).toBe("target");
      expect(filter._gain.directSets()).toBe(0); // ห้าม param.value =
    }
    const engineInternal = engine as unknown as {
      eqFilters: FakeFilter[];
      audioCtx: { currentTime: number };
    };
    expect(engineInternal.eqFilters[9]!._gain.calls[0]!.v).toBe(0);
  });

  it("null = Flat — ทุก filter เฟดกลับ 0", () => {
    const { engine, filters } = engineWithGraph();
    engine.applyEq(null);
    for (const filter of filters) {
      expect(filter._gain.calls[0]!.v).toBe(0);
    }
  });

  it("graph ยังไม่เกิด (ยังไม่มี gesture) → เก็บไว้ apply ตอนสร้าง graph", () => {
    const { engine, engineInternal } = engineWithGraph();
    engineInternal.audioCtx = null; // จำลองก่อน ensureAudioGraph
    engine.applyEq([8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(engineInternal.pendingEqBands).toEqual([8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // ensureAudioGraph จะ applyEq(pendingEqBands) ต่อทันทีที่ graph พร้อม (ครอบใน smoke)
  });
});
