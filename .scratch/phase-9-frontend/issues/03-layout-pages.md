# 03 — web layout + ทุกหน้า

Status: resolved

## งาน

- `components/layout/AppShell.tsx`: sidebar (desktop ≥ md) + bottom nav (mobile) —
  Home/Search/Library/Settings; PlayerBar+QueuePanel อยู่ layout-level (ไม่ unmount)
- `pages/HomePage.tsx` ใหม่: greeting ตามเวลา + shortcut ไป Search/Library/Settings +
  คิวปัจจุบัน (จาก queueStore) — search ย้ายออก
- `pages/SearchPage.tsx`: ย้าย search เดิม (useSearch + pagination) มาพร้อม
  loading/empty/error/degraded states
- `pages/LibraryPage.tsx`: tabs Playlists/Liked/History → EmptyState ทั้งหมด + หมายเหตุ
  "Phase 10" + ลิงก์ไป search
- `pages/PlaylistPage.tsx`: /playlist/:id → not-found/empty placeholder
- `pages/SettingsPage.tsx` เพิ่ม: ภาษา (th/en) + บัญชี (email + logout) + EQ เดิม

## Test

- AppShell nav render + navigate; Library tabs; route /playlist/:id placeholder;
  SearchPage states (mock useSearch)

## Evidence (2026-09-21)

- AppShell (sidebar md+ / bottom nav mobile ที่บน PlayerBar) + Routes ใหม่:
  / (Home greeting+cards+queue summary), /search (ย้ายจาก HomePage), /library (3 tabs +
  EmptyState + deep-link ?tab=), /playlist/:id (placeholder), /settings (ภาษา+บัญชี+EQ)
- TrackPage/LoginPage/QueuePanel/EqualizerPanel/PlayerBar ทั้งหมดผ่าน t()
- AppShell.test + LibraryPage.test + PlaylistPage.test เขียว
