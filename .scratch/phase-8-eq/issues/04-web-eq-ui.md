# 04 — web: EQ UI (SettingsPage + EqualizerPanel) + api client

Status: resolved

## งาน

- `api/index.ts` += `eqApi` (getPresets/createPreset/updatePreset/deletePreset/setActive)
  - `settingsApi` (get/patch)
- `components/eq/EqualizerPanel.tsx`: preset selector (system + custom + "ไม่ใช้ EQ"),
  slider 10 band (−12..+12 step 0.5) — ลาก → engine.applyEq ทันที (ไม่ throttle ฝั่งเสียง),
  ปุ่มบันทึกเป็น custom preset (POST) → ถามชื่อ → setActive, ปุ่มลบ custom
- `pages/SettingsPage.tsx` + route `/settings` (RequireAuth) + ลิงก์ใน header ของ
  HomePage ("ตั้งค่า")
- เลือก preset: apply local ทันที (engine.applyEq) แล้วยิง PUT /eq/active — EQ_CHANGED
  ที่ตัวเองจะได้รับกลับมาเป็น confirm (version gate ปกติ)

## Test

- `EqualizerPanel.test.tsx`: render 10 sliders + presets; ลาก slider → engine.applyEq
  ถูกเรียกด้วย bands ใหม่; เลือก preset → eqApi.setActive + engine.applyEq; บันทึก custom
  → POST + setActive; ลบ custom → DELETE (mock api ทั้งหมด)

## Evidence (2026-09-21)

- EqualizerPanel (select preset / slider 10 band step 0.5 / บันทึก custom ผ่าน prompt /
  ลบ custom / รีเซ็ต Flat) + SettingsPage (route /settings) + ลิงก์ "ตั้งค่า" ใน header
- บั๊กที่ test จับได้: onSelectPreset อ่าน presets จาก closure เก่า → preset ที่เพิ่ง
  บันทึกหาไม่เจอ แล้วยิง setActive(null) — แก้ให้อ่านจาก useEqStore.getState() สด ๆ
- EqualizerPanel.test.tsx 6 tests เขียว (mock api + engine)
