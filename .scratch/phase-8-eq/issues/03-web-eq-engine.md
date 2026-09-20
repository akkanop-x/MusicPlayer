# 03 — web: eqGraph + engine wiring + store + realtime handler

Status: resolved

## งาน

- `lib/eqGraph.ts` (ใหม่): `createEqFilters(ctx: BaseAudioContext): BiquadFilterNode[]` —
  จาก EQ_BANDS (ตัวเดียวกันทั้ง engine และ OfflineAudioContext ตอน smoke); ห้ามแตะ `.value`
  ของ gain param ในโมดูลนี้
- audioEngine: ensureAudioGraph ต่อ chain ใหม่ `mediaSource → filters×10 → gainNode →
compressor(threshold −6) → destination`; field `eqBands` จับค่าล่าสุด;
  `applyEq(bands: number[] | null)` — `setTargetAtTime(gain, currentTime, 0.05)` ทุก filter
  (null = zeros), graph ยังไม่เกิด → เก็บไว้ apply ตอนสร้าง
- `stores/eqStore.ts`: `{presets, activePresetId, activeBands, draftBands}` + actions;
  draft = ค่า slider ที่กำลังลาก (apply เสียงทันที แต่ยังไม่ persist)
- `realtime/handlers.ts`: EQ_CHANGED → set store + engine.applyEq (ผ่าน version gate เดิม)
- boot: App effect (มี token) → ดึง settings + presets → เติม store + engine.applyEq
  (EQ ถูกต้องตั้งแต่เสียงแรก — equalizer.md §5)

## Test

- `eqGraph.test.ts` (mock AudioParam): 10 filters type/freq/Q ถูก; applyEq ยิง
  setTargetAtTime ครบ 10 ค่า + timeConstant 0.05; **ไม่มี `param.value =`** (spy)
- `handlers.test.ts` เพิ่ม EQ_CHANGED → store+engine ถูกเรียก
- boot load: mock api → store มี presets/activeBands หลัง hydrate

## Evidence (2026-09-21)

- eqGraph.ts + audioEngine chain ใหม่ `mediaSource → EQ×10 → gain → compressor(−6 dB) →
destination` + applyEq (setTargetAtTime 0.05 เท่านั้น) + pendingEqBands สำหรับก่อน first gesture
- eqStore + refreshEqFromServer (boot จาก App effect) + handler EQ_CHANGED (set store +
  applyEq + เคลียร์ draft)
- tests: eqGraph.test (ห้าม .value — วัดจาก setter spy), handlers EQ_CHANGED,
  eqStore boot 4 cases — web รวม 43 เขียว
