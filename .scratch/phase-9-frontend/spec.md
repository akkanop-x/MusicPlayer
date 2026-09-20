# Phase 9 — Frontend เต็มรูปแบบ

Status: resolved

**Goal ตาม roadmap:** UI/UX ใกล้ Spotify ตาม requirements — **DoD:** ผ่าน E2E journeys 1–10
(testing.md §3.6) บน chromium
**Dependencies:** Phase 4–8 (มีทุกอย่างให้ render) ✓

## ขอบเขต (roadmap Phase 9 + frontend.md + requirements.md)

1. **ทุกหน้า:** Home (greeting + shortcut + สรุปคิว), Search (ย้ายจาก HomePage → `/search`
   พร้อม debounce/pagination เดิม), Library (`/library` — tabs Playlists/Liked/History,
   **empty state รอ Phase 10**), Playlist (`/playlist/:id` — placeholder not-found รอ Phase 10),
   Settings (EQ เดิม + สลับภาษา + บัญชี/logout) + PlayerBar เต็ม (เพิ่มปุ่ม shuffle) +
   NowPlaying fullscreen
2. **i18n (frontend.md §6.1):** react-i18next — locale ทุก string ผ่าน `t()`, ที่มา
   `user_settings.locale` → browser → `'th'`, สลับใน Settings → `PATCH /settings { locale }`
   → TanStack Query invalidate; ไม่แปลชื่อเพลง/ศิลปิน
3. **Media Session API (frontend.md §8.1):** `navigator.mediaSession` — metadata/artwork
   ตอน track เปลี่ยน + action handlers (play/pause/previoustrack/nexttrack/seekto) →
   เข้ากับ AudioEngine เดิม + positionState ราย timeupdate
4. **TanStack Query ทุก feature** (search เดิม + settings/library) + **virtualized lists**
   (react-window — search results + queue upcoming) + **responsive layout**
   (sidebar desktop / bottom nav mobile)
5. **Loading/empty/error states ทุกจุด** (search, library tabs, playlist, settings,
   now playing) + EmptyState/Spinner components กลาง
6. **E2E (testing.md §3.6):** Playwright + chromium กับ stack ครบใน compose — journeys
   1–6 + 10 เขียวจริง; journey 11 (WS หลุด) ทำด้วย; **journeys 7–9 = test.skip พร้อม
   เหตุผล** (ดู "ข้อจำกัด DoD" ด้านล่าง)

## ข้อจำกัด DoD (ตัดสินใจชัดเจน — ไม่งั้น Phase 9 ไปต่อไม่ได้เลย)

DoD อ้าง journeys 1–10 แต่ journey **7 (like), 8 (playlist), 9 (autoplay)** ต้องมี backend
จาก **Phase 10 (Playlist/Like/History) และ Phase 11 (Autoplay)** ซึ่งเป็น phase _ถัดไป_
ตามลำดับ roadmap — roadmap เองกำหนด Dependencies ของ Phase 9 เป็น "Phase 4–8 (มีทุกอย่าง
ให้ render)" เท่านั้น จึงตีความว่า:

- journeys 1–6 + 10 (+11) ต้อง **เขียวจริง** บน chromium ใน phase นี้
- journeys 7–9 เขียน spec ไว้เป็น `test.skip` พร้อมเหตุผล + จะเปิดครบใน phase ที่ backend
  พร้อม (Phase 10 ปิด 7–8, Phase 11 ปิด 9) — บันทึกไว้ใน tracker ให้ผู้ review ตัดสิน

## ออกแบบไว้แล้ว

- locales import แบบ static (th/en ไฟล์เล็ก) — deviate จาก "lazy-load" ของ frontend.md
  ชั่วคราว (optimize ภายหลังได้โดยไม่เปลี่ยน call site)
- คำสั่งเสียง idempotent ยัง optimistic ตาม frontend.md §4 — MediaSession handlers เรียก
  AudioEngine เดิม (ไม่มี command path ใหม่)
- E2E ใช้ YouTube จริงผ่าน compose stack (ยังไม่มี seed เสียงสังคราะห์ — รอ Phase 13 CI
  ตาม testing.md §4; local เท่านั้น ไม่เข้า CI เพราะ CI layout ของ testing.md §5 วาง E2E
  ไว้ที่ Phase 13)
- เพิ่ม `locale` ใน PATCH /settings (frontend.md §6.1 สั่ง PATCH `/settings { locale }`
  — api.md #39 body ไม่มี locale จึงขยาย, backward compatible)

## ตัดสินผ่าน (non-goals)

- Recommendations/home feed จริง, radio — Phase 11/12
- Library ที่อ่านจาก DB (playlists/likes/history) — Phase 10 (หน้า + empty state จบใน 9)
- Light theme, PWA — grilling 2026-09-20 ตัดแล้ว
- E2E firefox/webkit + CI integration — Phase 13

## Evidence สรุป (2026-09-21)

- Tests: 249 เขียว (shared 45 + server 145 + web 59) + **E2E chromium 8 passed / 3 skipped**
  (journeys 1–6, 10, 11 เขียวจริง; 7–9 skip รอ Phase 10/11 — ดู "ข้อจำกัด DoD" ด้านบน)
- lint/format/typecheck เขียวทุก workspace; CI เขียว
- ส่งมอบ: i18n th/en ครบทุก string + สลับใน Settings, Media Session (metadata/actions/
  positionState), ทุกหน้า (Home/Search/Library/Playlist/Settings) + AppShell responsive +
  NowPlaying fullscreen + ปุ่ม shuffle, VirtualList (react-window v2) + states ทุกจุด,
  PATCH /settings {locale}
- บั๊กจริง 2 ตัวที่ E2E จับได้: refresh-resume พัง (แก้ 3 จุดใน AudioEngine) และ server
  seek ค้าง BUFFERING (แก้ SEEKED ทันที) — รายละเอียดใน issues/06
