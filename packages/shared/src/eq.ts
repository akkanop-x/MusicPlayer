/**
 * Equalizer — equalizer.md (Web Audio BiquadFilter chain ประมวลผลที่ browser ทั้งหมด;
 * backend เก็บแค่ค่า preset) — constants/DTO/validation ชุดเดียวทั้ง server และ web
 */
import type { RepeatMode } from "./playerState.js";

export const EQ_BAND_COUNT = 10;
export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;

export type EqFilterType = "lowshelf" | "peaking" | "highshelf";

/** 10 band ISO octave — freq/Q fix (equalizer.md §2), ผู้ใช้ปรับแค่ gain */
export const EQ_BANDS: ReadonlyArray<{
  freq: number;
  type: EqFilterType;
  q: number;
}> = [
  { freq: 31.25, type: "lowshelf", q: 0.707 },
  { freq: 62.5, type: "peaking", q: 1.0 },
  { freq: 125, type: "peaking", q: 1.0 },
  { freq: 250, type: "peaking", q: 1.0 },
  { freq: 500, type: "peaking", q: 1.0 },
  { freq: 1000, type: "peaking", q: 1.0 },
  { freq: 2000, type: "peaking", q: 1.0 },
  { freq: 4000, type: "peaking", q: 1.0 },
  { freq: 8000, type: "peaking", q: 1.0 },
  { freq: 16000, type: "highshelf", q: 0.707 },
];

/** system preset id คงที่ — seed idempotent (insert onConflictDoNothing) + test อ้างอิงได้ */
export const SYSTEM_EQ_PRESET_IDS = {
  flat: "00000000-0000-4000-8000-000000000001",
  pop: "00000000-0000-4000-8000-000000000002",
  rock: "00000000-0000-4000-8000-000000000003",
  classical: "00000000-0000-4000-8000-000000000004",
  jazz: "00000000-0000-4000-8000-000000000005",
  vocal: "00000000-0000-4000-8000-000000000006",
  bassBoost: "00000000-0000-4000-8000-000000000007",
} as const;

/** gain (dB) ต่อ band 31.25 Hz → 16 kHz ตาม equalizer.md §4 */
export const SYSTEM_EQ_PRESETS: ReadonlyArray<{
  id: string;
  name: string;
  gains: number[];
}> = [
  {
    id: SYSTEM_EQ_PRESET_IDS.flat,
    name: "Flat",
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: SYSTEM_EQ_PRESET_IDS.pop,
    name: "Pop",
    gains: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  },
  {
    id: SYSTEM_EQ_PRESET_IDS.rock,
    name: "Rock",
    gains: [4, 3, 1, 0, -1, 0, 1, 3, 4, 4],
  },
  {
    id: SYSTEM_EQ_PRESET_IDS.classical,
    name: "Classical",
    gains: [3, 2, 0, 0, 0, 0, 0, 2, 3, 4],
  },
  {
    id: SYSTEM_EQ_PRESET_IDS.jazz,
    name: "Jazz",
    gains: [2, 3, 1, 2, -1, -1, 0, 1, 3, 3],
  },
  {
    id: SYSTEM_EQ_PRESET_IDS.vocal,
    name: "Vocal",
    gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  },
  {
    id: SYSTEM_EQ_PRESET_IDS.bassBoost,
    name: "Bass Boost",
    gains: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  },
];

/** api.md §10 — preset คืนเป็น gain ต่อ band (freq/Q fix ตาม EQ_BANDS, เก็บ JSONB ครบทั้งชุด) */
export interface EqPresetDTO {
  id: string;
  name: string;
  bands: number[];
  isSystem: boolean;
}

/** api.md §4 endpoint 38 — GET/PATCH /settings */
export interface UserSettingsDTO {
  volume: number;
  muted: boolean;
  autoplay: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  /** NULL = ไม่ใช้ EQ (Flat) */
  activeEqPresetId: string | null;
  locale: string;
}

/** ตรวจ bands จาก client — คืน array ใหม่ถ้า valid, ไม่งั้น null (api.md §10: 400) */
export function validateEqBands(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length !== EQ_BAND_COUNT) return null;
  const bands: number[] = [];
  for (const raw of input) {
    const gain = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(gain) || gain < EQ_GAIN_MIN || gain > EQ_GAIN_MAX) return null;
    bands.push(Math.round(gain * 2) / 2); // step 0.5 dB (equalizer.md §2)
  }
  return bands;
}

// ---------- RBJ biquad magnitude response (test-support — สูตรตาม Web Audio spec) ----------
// peaking/lowshelf/highshelf ตาม RBJ Audio EQ Cookbook (สูตรเดียวกับ BiquadFilterNode)

interface Coefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function rbjCoefficients(
  band: { freq: number; type: EqFilterType; q: number },
  gainDb: number,
  sampleRate: number,
): Coefficients {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * band.freq) / sampleRate;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  if (band.type === "peaking") {
    const alpha = sw / (2 * band.q);
    const b0 = 1 + alpha * A;
    const b1 = -2 * cw;
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * cw;
    const a2 = 1 - alpha / A;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * (sw / (2 * 0.707));
  const isLow = band.type === "lowshelf";
  const b0 =
    A *
    (isLow
      ? A + 1 - (A - 1) * cw + twoSqrtAAlpha
      : A + 1 + (A - 1) * cw + twoSqrtAAlpha);
  const b1 = isLow ? 2 * A * (A - 1 - (A + 1) * cw) : -2 * A * (A - 1 + (A + 1) * cw);
  const b2 =
    A *
    (isLow
      ? A + 1 - (A - 1) * cw - twoSqrtAAlpha
      : A + 1 + (A - 1) * cw - twoSqrtAAlpha);
  const a0 = isLow
    ? A + 1 + (A - 1) * cw + twoSqrtAAlpha
    : A + 1 - (A - 1) * cw + twoSqrtAAlpha;
  const a1 = isLow ? -2 * (A - 1 + (A + 1) * cw) : 2 * (A - 1 - (A + 1) * cw);
  const a2 = isLow
    ? A + 1 + (A - 1) * cw - twoSqrtAAlpha
    : A + 1 - (A - 1) * cw - twoSqrtAAlpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * Magnitude response (dB) ของ EQ chain ที่ freq ที่กำหนด — ผลคูณ response ของทุก band
 * (ใช้ใน unit test เทียบ expected gain ±1.5 dB; สูตรตรงกับ BiquadFilterNode ของ browser)
 */
export function eqMagnitudeResponseDb(
  gains: number[],
  freqs: number[],
  sampleRate = 48_000,
): number[] {
  return freqs.map((freq) => {
    const w = (2 * Math.PI * freq) / sampleRate;
    let magnitude = 1;
    for (const [i, band] of EQ_BANDS.entries()) {
      const coeffs = rbjCoefficients(band, gains[i] ?? 0, sampleRate);
      const z1Re = Math.cos(w);
      const z1Im = -Math.sin(w);
      const z2Re = Math.cos(2 * w);
      const z2Im = -Math.sin(2 * w);
      const numRe = coeffs.b0 + coeffs.b1 * z1Re + coeffs.b2 * z2Re;
      const numIm = coeffs.b1 * z1Im + coeffs.b2 * z2Im;
      const denRe = 1 + coeffs.a1 * z1Re + coeffs.a2 * z2Re;
      const denIm = coeffs.a1 * z1Im + coeffs.a2 * z2Im;
      magnitude *= Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
    }
    return 20 * Math.log10(magnitude);
  });
}
