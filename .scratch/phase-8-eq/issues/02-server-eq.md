# 02 — server: eq repo + routes + settings + seed + EQ_CHANGED

Status: resolved

## งาน

- `repositories/eq.repo.ts`: listPresets (system + ของ user, system ก่อน), findPreset,
  createPreset (bands number[] → JSONB `[{freq,gain,q}]` จาก EQ_BANDS), updatePreset,
  deletePreset, getActivePresetId / saveActivePresetId, getSettings (ขยาย player.repo
  shape → UserSettingsDTO ครบ activeEqPresetId/locale), patchSettings (volume/muted/autoplay)
- `routes/eq.routes.ts` (requireAuth เดิม): api.md §10 #38–44
  - GET `/settings`, PATCH `/settings` (#38/39)
  - GET `/eq/presets` → `{presets}` (#40), POST → 201/400/409 ชื่อซ้ำ (#41)
  - PATCH `/eq/presets/:id` → 403 ถ้า system/ไม่ใช่ของตัวเอง, 404 (#42)
  - DELETE `/eq/presets/:id` → 204/403/404 (#43; FK ตั้ง active_eq_preset_id = NULL เอง)
  - PUT `/eq/active` `{presetId|null}` → UserSettingsDTO / 404 (#44)
- **EQ_CHANGED broadcast ที่ routes** (มี userId + hub): setActive / PATCH preset ที่ active /
  DELETE preset ที่ active → `hub.emitToUser(userId, RealtimeEvents.EqChanged,
{presetId, bands})` — bands มาจาก preset, null → `{presetId: null, bands: null}`
- **seed ตอน boot** (`index.ts` หลัง migrate): `seedSystemPresets(db)` insert system 7 presets
  ตาม id คงที่ (onConflictDoNothing target id) — idempotent
- app.ts: ย้าย `new RealtimeHub()` ขึ้น top-level ของ buildApp, register eqRoutes เมื่อ
  `deps.eq || deps.db`, AppDeps += `eq?`

## Test — `eq.contract.test.ts` (hermetic inject ตาม pattern player.contract)

- GET presets ครบ system+custom; POST ปกติ/ชื่อซ้ำ 409/bands พัง 400; PATCH ของตัวเอง/
  system 403/ไม่มี 404; DELETE system 403 + custom 204; PUT active → settings กลับมา
  activeEqPresetId ถูก, presetId ไม่มีตัวตน 404, null = flat
- **EQ_CHANGED ผ่าน WS จริง:** buildApp({eq: mock, hub}) + socket.io-client → PUT /eq/active
  → ทั้งสอง tab ของ user ได้ EQ_CHANGED {presetId, bands, version}, user อื่นเงียบ
- PATCH settings (volume/muted/autoplay) → กลับค่าที่ตั้ง

## Evidence (2026-09-21)

- eq.repo.ts / EqService.ts / eq.routes.ts ครบ #38–44 + seedSystemEqPresets ที่ index.ts boot
- เพิ่ม error code EQ_PRESET_NAME_TAKEN (409) ใน shared/errors (ต่อยอดรายการ backend.md §4
  เหมือน EMAIL_TAKEN ที่ phase ก่อนเคยเพิ่ม)
- eq.contract.test.ts 9 tests เขียว (REST 8 + WS broadcast 1) — server รวม 144
- บั๊กระหว่างทำ: ลืมเพิ่ม `EqChanged` ใน RealtimeEvents const (มีแต่ payload type จาก Phase 7)
  → typecheck จับได้ทันที; zod default strip unknown keys เหมือน routes เดิม — test จึงเน้น
  กรณีค่าผิด range
