# Phase 8 — EQ

Status: resolved

**Goal ตาม roadmap:** Equalizer ใช้งานได้จริง — **DoD:** เปลี่ยน band ระหว่างเล่น → ได้ยินเปลี่ยน
ไม่มี click/pop; preset คงอยู่หลัง refresh; ผ่าน frequency response tests
**Dependencies:** Phase 4 (Web Audio อยู่ใน pipeline แล้ว) ✓, Phase 5–7 ✓ (EQ_CHANGED มี hub รออยู่)

## ขอบเขต (equalizer.md + api.md §10 + roadmap Phase 8)

1. **eqGraph (web):** `MediaElementSource → BiquadFilter ×10 → GainNode(volume) →
DynamicsCompressorNode(−6 dB) → destination` — สร้างครั้งเดียวตอน first gesture
   (edge #8 เดิม), เปลี่ยนแค่พารามิเตอร์ ไม่ rebuild
2. **Bands:** 10 band ISO octave ตาม equalizer.md §2 — lowshelf 31.25 Hz / peaking
   62.5 Hz–8 kHz (Q=1) / highshelf 16 kHz; gain −12..+12 dB; freq/Q fix
3. **Real-time:** ทุกการเปลี่ยน gain ใช้ `setTargetAtTime(value, t, 0.05)` เท่านั้น —
   ห้าม `param.value =` ตรง ๆ (กัน click/pop; unit test มี assertion ผ่าน spy)
4. **Presets:** system 7 presets (Flat/Pop/Rock/Classical/Jazz/Vocal/Bass Boost) seed
   ลง `eq_presets` ตอน server boot (id คงที่, user_id NULL, แก้/ลบไม่ได้ → 403);
   custom preset CRUD ของ user; active เก็บ `user_settings.active_eq_preset_id`
   (NULL = Flat)
5. **Endpoints (api.md §10):** GET/PATCH `/settings` (#38/39), GET/POST `/eq/presets`
   (#40/41), PATCH/DELETE `/eq/presets/:id` (#42/43), PUT `/eq/active` (#44);
   validate bands (ความยาว 10, ∈ [−12, +12])
6. **EQ_CHANGED (websocket.md §3):** broadcast ไป room user เมื่อ active preset เปลี่ยน,
   แก้ preset ที่กำลัง active, หรือลบ preset ที่กำลัง active (FK set null → {presetId:null,
   bands:null}); payload `{presetId, bands}` + version envelope จาก RealtimeHub
7. **EQ UI:** หน้า `/settings` (SettingsPage) + EqualizerPanel (10 sliders + preset
   selector + บันทึก custom) — ลาก slider apply ที่เสียงทันที, เลือก preset → apply local
   ก่อนแล้วค่อยยิง REST (equalizer.md §5); boot โหลด presets + settings → EQ ถูกต้อง
   ตั้งแต่เสียงแรก

## ออกแบบไว้แล้ว

- **Frequency response tests (testing.md §3.5):** 2 ชั้น —
  (1) hermetic unit test ใช้ RBJ cookbook magnitude-response math (สูตรเดียวกับ spec ของ
  BiquadFilterNode) ใน `packages/shared/eq.ts`: Flat = identity (0 dB), preset แต่ละอันมี
  response ตรง gain ที่ band กลาง ±1.5 dB;
  (2) browser จริง (smoke): สร้าง OfflineAudioContext ในหน้า + `createEqFilters()`
  ตัวเดียวกับ engine → `getFrequencyResponse()` วัดของจริง
- **Bands JSONB:** เก็บ `[{freq, gain, q}]` ครบ (forward-compatible ตาม equalizer.md §6)
  แต่ DTO/API ใช้ `bands: number[]` (gain ต่อ band); ตรวจ freq ผ่าน EQ_BANDS constants
- **Broadcast อยู่ที่ routes** (มี userId + hub ครบ) — service ฝั่ง eq เป็น persistence ล้วน
  inject ใน contract test ได้; hub ย้ายขึ้น top-level ของ buildApp ให้ player/eq ใช้ร่วมกัน
- **Compressor เป็น default safety** (equalizer.md §7 ตัดสินแล้ว) — gain รวมสูงไม่ distort
- ระบบ EQ ประมวลผลที่ browser ทั้งหมด — backend เก็บแค่ค่า preset (ไม่มีฝั่งเสียงบน server)

## ตัดสินผ่าน (non-goals)

- Preamp slider — ไม่ทำ (equalizer.md §9: compressor พอ)
- AnalyserNode visualizer — nice-to-have ไม่อยู่ใน MVP
- custom Q/freq per band — นอก scope (ผู้ใช้ปรับแค่ gain)
- Safari/iOS E2E แยก — chain standard หมด, บันทึกไว้ให้ Phase 12 (cross-browser)
- แก้ไข bands เปล่า ๆ โดยไม่มี preset — ยังไม่ persist (api.md #44 รับแค่ presetId|null);
  จะ persist เมื่อกดบันทึกเป็น custom preset

## Evidence สรุป (2026-09-21)

- Tests: 232 เขียว (shared 45 รวม eq 10 + server 144 รวม eq.contract 9 + web 43 รวม
  EQ 12); lint/format/typecheck ผ่านทุก workspace
- **DoD ✓** เปลี่ยน band ระหว่างเล่น → apply ทันที เสียงเล่นต่อเนื่อง (ดู issues/05)
- **DoD ✓** preset คงอยู่หลัง refresh (Bass Boost → reload → ตรงทั้ง 10 band)
- **DoD ✓** frequency response: Flat = identity 0 dB + Bass Boost ตรงสูตร (OfflineAudioContext
  จริง ตรงกับ RBJ unit test 0.01 dB)
- Bonus: EQ_CHANGED sync ข้าม tab จริง + seed 7 system presets ใน docker ยืนยันผ่าน API

## ตัดสินใจ/บันทึกระหว่างทำ

- เพิ่ม error code `EQ_PRESET_NAME_TAKEN` (409) ต่อยอดรายการ backend.md §4
- แก้ preset ที่ active แล้ว broadcast EQ_CHANGED ที่ routes (spec.md §ออกแบบไว้แล้ว)
- ลบ preset ที่ active → FK set null → broadcast `{presetId: null, bands: null}` = Flat
- แก้ไข bands เปล่า ๆ ยังไม่ persist จนกว่าจะบันทึกเป็น custom preset (api.md #44)
- รายละเอียด smoke + lessons อยู่ใน issues/05
