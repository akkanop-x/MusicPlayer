# 01 — shared: EQ constants + DTO + magnitude response helper

Status: resolved

## งาน

- `packages/shared/src/eq.ts` (ใหม่):
  - `EQ_BANDS`: 10 band ตาม equalizer.md §2 — `{freq, type: "lowshelf"|"peaking"|"highshelf", q}`
    (31.25 lowshelf 0.707 / 62.5,125,250,500,1k,2k,4k,8k peaking 1.0 / 16k highshelf 0.707)
  - `EQ_GAIN_MIN = -12`, `EQ_GAIN_MAX = 12`, `EQ_BAND_COUNT = 10`
  - `SYSTEM_EQ_PRESETS`: 7 presets ตาม equalizer.md §4 — id UUID คงที่
    (`00000000-0000-4000-8000-0000000000NN`) เพื่อ seed idempotent + อ้างอิงใน test ได้
  - `EqPresetDTO {id, name, bands: number[], isSystem}` + `UserSettingsDTO`
    (volume/muted/autoplay/repeatMode/shuffle/activeEqPresetId/locale)
  - `validateEqBands(input: unknown): number[] | null` — ความยาว 10, ตัวเลข finite,
    ∈ [−12, +12] (round เป็น step 0.5 ได้จาก UI ฝั่งเดียว)
  - `eqMagnitudeResponseDb(gains, freqs, sampleRate=48000): number[]` — RBJ cookbook
    peaking/shelf magnitude ทับกันเป็น chain (test ใช้; สูตรตรงกับ Web Audio spec)
- export ผ่าน `src/index.ts`

## Test

- `eq.test.ts`: validateEqBands (ผ่าน/ยาวไม่ครบ/เกินขอบ/NaN); magnitude — Flat = 0 dB ทุก freq;
  Pop/Bass Boost response ตรง gain ที่ band กลาง ±1.5 dB; preset seed ทุกอัน ความยาว 10 ∈ [−12,12]

## Evidence (2026-09-21)

- `packages/shared/src/eq.ts` ครบตามสเปค + `src/eq.test.ts` 10 tests เขียว (shared รวม 45)
- Lesson ระหว่างทำ: สูตร RBJ ถูกตั้งแต่แรก แต่ eval response ใช้ w = 2πf ไม่ได้หาร sampleRate
  (shadowed variable) — ตรวจสูตรด้วยค่า reference: peaking@center = gain เป๊ะ,
  shelf@corner = ครึ่งเดินทาง (ทฤษฎีตรงกัน) — tolerance รวม preset ใช้ ±3 dB เพราะ
  band ข้างเคียงซึมกัน (Q=1, spacing 1 octave)
