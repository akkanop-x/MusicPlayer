/**
 * EQ shared — equalizer.md §2/§4 + testing.md §3.5 (frequency response ±1.5 dB, Flat = identity)
 * eqMagnitudeResponseDb ใช้ RBJ cookbook (สูตรเดียวกับ BiquadFilterNode spec) → deterministic hermetic
 */
import { describe, expect, it } from "vitest";
import {
  EQ_BANDS,
  EQ_BAND_COUNT,
  SYSTEM_EQ_PRESETS,
  eqMagnitudeResponseDb,
  validateEqBands,
} from "./eq.js";

describe("validateEqBands", () => {
  it("ผ่าน bands ครบ 10 ค่า และ round เป็น step 0.5", () => {
    const bands = validateEqBands([0, 1.2, -3.7, 12, -12, 4, 0.25, -0.3, 8, 0]);
    expect(bands).toEqual([0, 1, -3.5, 12, -12, 4, 0.5, -0.5, 8, 0]);
  });
  it("ปฏิเสธ ความยาวไม่ครบ / เกินขอบ / ไม่ใช่ตัวเลข", () => {
    expect(validateEqBands([0, 0, 0])).toBeNull();
    expect(validateEqBands(new Array(9).fill(0))).toBeNull();
    expect(validateEqBands(new Array(10).fill(13))).toBeNull();
    expect(validateEqBands(new Array(10).fill(-12.5))).toBeNull();
    expect(validateEqBands(new Array(10).fill("x"))).toBeNull();
    expect(validateEqBands(new Array(10).fill(Number.NaN))).toBeNull();
    expect(validateEqBands("nope")).toBeNull();
  });
});

describe("system presets (equalizer.md §4)", () => {
  it("7 presets ความยาว 10, gain ∈ [−12, +12]", () => {
    expect(SYSTEM_EQ_PRESETS.length).toBe(7);
    for (const preset of SYSTEM_EQ_PRESETS) {
      expect(preset.gains.length).toBe(EQ_BAND_COUNT);
      for (const gain of preset.gains) {
        expect(gain).toBeGreaterThanOrEqual(-12);
        expect(gain).toBeLessThanOrEqual(12);
      }
    }
  });
  it("ชื่อ/id ไม่ซ้ำกัน", () => {
    const ids = SYSTEM_EQ_PRESETS.map((p) => p.id);
    const names = SYSTEM_EQ_PRESETS.map((p) => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("eqMagnitudeResponseDb (testing.md §3.5)", () => {
  it("Flat = identity — 0 dB ทุกความถี่", () => {
    const flat = new Array(EQ_BAND_COUNT).fill(0);
    const freqs = EQ_BANDS.map((b) => b.freq);
    for (const db of eqMagnitudeResponseDb(flat, freqs)) {
      expect(Math.abs(db)).toBeLessThan(0.01);
    }
  });
  it("peaking แต่ละ band ตอบตรง gain ที่ center (±0.5 dB — วัดแบบ single-band)", () => {
    for (const [i, band] of EQ_BANDS.entries()) {
      if (band.type !== "peaking") continue;
      const gains = new Array(EQ_BAND_COUNT).fill(0);
      gains[i] = 9;
      const [db] = eqMagnitudeResponseDb(gains, [band.freq]);
      expect(Math.abs(db! - 9)).toBeLessThanOrEqual(0.5);
    }
  });
  it("band ข้างเคียง (spacing 1 octave, Q=1) ซึมกัน ≤ 40% ของ gain", () => {
    const gains = new Array(EQ_BAND_COUNT).fill(0);
    gains[3] = 10; // 250 Hz
    const [at125, at500] = eqMagnitudeResponseDb(gains, [125, 500]);
    expect(Math.abs(at125!)).toBeLessThanOrEqual(4);
    expect(Math.abs(at500!)).toBeLessThanOrEqual(4);
  });
  it("shelf ปลายสองข้าง: plateau ตรง gain (วัดที่ 10 Hz / 20 kHz)", () => {
    const gains = new Array(EQ_BAND_COUNT).fill(0);
    gains[0] = 8; // lowshelf 31.25 Hz
    gains[9] = -6; // highshelf 16 kHz
    const [lowPlateau, , highPlateau] = eqMagnitudeResponseDb(
      gains,
      [10, 1000, 20_000],
    );
    expect(Math.abs(lowPlateau! - 8)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(highPlateau! + 6)).toBeLessThanOrEqual(1.5);
    // กลางเส้น (1 kHz) แทบไม่โดน shelf ทั้งสอง
    const [mid] = eqMagnitudeResponseDb(gains, [1000]);
    expect(Math.abs(mid!)).toBeLessThanOrEqual(1);
  });
  it("preset รวม (Bass Boost): รูปทรงตรงที่ peak centers ±3 dB (band ข้างเคียงซึมบ้าง)", () => {
    const gains = SYSTEM_EQ_PRESETS.find((p) => p.name === "Bass Boost")!.gains;
    const freqs = EQ_BANDS.map((b) => b.freq);
    const response = eqMagnitudeResponseDb(gains, freqs);
    for (let i = 0; i < EQ_BAND_COUNT; i += 1) {
      expect(Math.abs(response[i]! - gains[i]!)).toBeLessThanOrEqual(3);
    }
  });
  it("sample rate 44100 ก็ยังตรง (peaking ที่ center + shelf plateau)", () => {
    const gains = [8, 0, 0, 0, 0, 0, 0, 0, 0, -8];
    const response = eqMagnitudeResponseDb(gains, [10, 1000, 20_000], 44_100);
    expect(Math.abs(response[0]! - 8)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(response[1]!)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(response[2]! + 8)).toBeLessThanOrEqual(2);
  });
});
