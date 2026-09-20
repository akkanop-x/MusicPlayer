# 01 — backend: PATCH /settings รับ locale

Status: resolved

## งาน

- `eq.routes.ts`: patchSettingsBody เพิ่ม `locale: z.enum(["th","en"]).optional()`
- `EqService.patchSettings` + `eq.repo.patchUserSettings` รับ `locale`
- คงข้อจำกัดเดิม: ค่าอื่น (repeatMode/shuffle) ยังจัดการผ่าน /player

## Test

- eq.contract.test.ts เพิ่ม: PATCH /settings { locale: "en" } → กลับ locale: "en";
  locale แปลกปลอม → 400

## Evidence (2026-09-21)

- locale (th|en) ผ่าน PATCH /settings ครบทั้ง chain (routes schema → service → repo)
- eq.contract.test.ts 10 tests เขียว (server รวม 145)
