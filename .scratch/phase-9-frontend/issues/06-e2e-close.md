# 06 — E2E Playwright (chromium) — journeys ตาม testing.md §3.6 + ปิด Phase

Status: resolved

## งาน

- devDep `@playwright/test` ใน apps/web + `playwright.config.ts` (baseURL
  http://localhost:8080, chromium, retries 1, trace on retry) + script `"e2e"`
- `apps/web/e2e/journeys.spec.ts` — จาก testing.md §3.6:
  - J1 สมัคร → ล็อกอิน → ค้นหา → เล่น → `audio.currentTime` เดิน + `!paused`
  - J2 play → pause → resume → position ต่อเนื่อง
  - J3 คิว 3 เพลง → skip ×2 → previous → เพลงถูกต้อง
  - J4 shuffle on → skip/previous → state สอดคล้อง (path จริง)
  - J5 seek กลางเพลง → UI + audio ตรง
  - J6 EQ Bass Boost → เสียงไม่หยุด ไม่ error (AudioContext state)
  - J7/J8/J9 = `test.skip` (Phase 10/11: likes/playlists/autoplay)
  - J10 refresh กลางเพลง → เล่นต่อ ±5 s
  - J11 WS หลุด (engine.close ผ่าน `__rt.simulateNetworkDrop()`) → เล่นต่อ → reconnect
- run ผ่าน compose stack ที่รันอยู่ (local — E2E เข้า CI ตอน Phase 13)
- ปิด Phase: smoke เพิ่มเติม Media Session (metadata ถูกตั้งจริง) + tracker resolved +
  format + commit/push + CI เขียว

## Evidence (2026-09-21) — chromium ผ่าน compose stack (local)

- Final run: **8 passed / 3 skipped, 18.7s** — J1 register→search→play→audible ✓,
  J2 pause/resume position ต่อเนื่อง ✓, J3 คิว 3 เพลง skip×2→previous = เพลงที่ 1 ที่เพิ่ม ✓,
  J4 shuffle mirror + skip/previous ✓, J5 seek 60 s → audio ตรง ✓,
  J6 EQ Bass Boost + resume ไม่พัง ✓, J10 refresh กลางเพลง → เล่นต่อ ±5 s ✓,
  J11 simulateNetworkDrop → เสียงเล่นต่อ → reconnect ✓; J7–J9 skip พร้อมเหตุผล
- **บั๊กจริงที่ E2E จับได้ (คุ้มค่าที่สุดของ phase นี้):**
  1. **Refresh-resume พังตั้งแต่ Phase 4** — restore เป็น PLAYING (optimistic) แต่ client
     ไม่มี src → กดเล่นต่อไม่ได้เลย แก้ 3 จุด: syncFromServer coerce PLAYING→PAUSED,
     applyRemotePlayerState PLAYING+no-src → mirror PAUSED, resume() โหลด src ใหม่ +
     fallback NOT_PAUSED (server restore PLAYING → resume 409) + jump position เดิม
  2. **Server seek ค้าง BUFFERING** — SEEK→BUFFERING ตาม player.md §3 แต่ server ไม่มี
     SEEKED คืน → ctx ค้าง BUFFERING ตลอดแล้ว broadcast ไปทุก tab แก้: seek จบด้วย
     SEEKED ทันที (contract test อัปเดต BUFFERING→PLAYING)
- Lessons:
  - `page.evaluate("() => ...")` ใน Playwright = expression → function object serialize
    เป็น undefined — ต้องใช้ IIFE `(() => ...)()`
  - pipe ออก tail กิน exit code ของ docker build → build พังเงียบ ๆ แล้ว serve bundle เก่า
    (สับสนยาว) — ตรวจ asset hash ทุกครั้งที่แก้โค้ดแล้วเทสไม่เปลี่ยนผล
  - register ต้องมี displayName (zod min 1)
  - Playwright ควร assert ผ่าน DOM เท่าที่จำเป็น + poll audio element — ตรง testing.md §3.6
