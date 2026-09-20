# 05 — states ทุกจุด + virtualized + responsive

Status: resolved

## งาน

- `components/ui/`: Spinner, EmptyState (icon/title/action), ErrorState (message/retry)
- ครอบทุกจุด: search results/library tabs/playlist/settings/queue — ไม่มี section ไหน
  render ว่างเปล่าเงียบ ๆ
- `components/ui/VirtualList.tsx` (react-window): ใช้กับ search results และ queue
  upcoming (จอสูง ~6 แถว, overscan) — แถวเดิมยังมีปุ่มเล่น/รายละเอียด/คิว
- responsive: AppShell + pages ผ่านบน 375 px (bottom nav) และ desktop (sidebar);
  NowPlaying ปรับตามจอ

## Test

- VirtualList render ย่อย + scroll แล้ว window เลื่อน (jsdom จำกัด — ทดสอบ
  ผ่านการ render เต็มใน smoke ด้วย); EmptyState/ErrorState/Spinner

## Evidence (2026-09-21)

- ui/Spinner/EmptyState/ErrorState + ครอบครบ: search (spinner/empty/error/degraded),
  library tabs, playlist, home queue; VirtualList (react-window v2 — rowKey/rowProps
  pattern) ใช้กับ search results + responsive layout ทั้ง AppShell/PlayerBar/NowPlaying
- VirtualList.test (jsdom stub ResizeObserver) เขียว; smoke responsive บน chromium
  ใน issues/06
