# 08 E2E J7/J8 + ปิด phase

Status: resolved

## Evidence

- E2E clean run: **10 passed / 1 skipped (J9 — Phase 11) in 24.8s** — journeys 1–8 + 10 + 11 ครบ
  (J7: like → reload → ยัง liked + หน้า liked แสดง; J8: สร้าง playlist → เพิ่ม 2 เพลง → เล่นทั้ง playlist ตามลำดับ → skip ต่อเพลงที่สอง)
- Unit tests 287 เขียว (shared 45 + server 175 + web 67); lint/format/typecheck เขียวทั้ง repo
- Docker stack rebuilt + served bundle มี marker ใหม่ (btn-play-playlist/playlist-dialog/history-day) — ตรวจ asset hash ก่อนรัน E2E (บทเรียน Phase 9)

## Lessons

- Playwright serial describe หลายก้อนที่แต่ละก้อนมี beforeAll/afterAll ปิด browser เอง → race "browser has been closed" (J7 flake) — รวมทุก journey ไว้ describe.serial เดียวใช้ page/beforeAll ร่วมกัน จบ flake
- vi.mock ทั้งโมดูล api เสี่ยงลืม export ที่ไฟล์อื่น import ต่อ (audioEngine) — stub global.fetch + fixture ตาม path แทน ปลอดภัยกว่า
- PlaylistDTO ต้องมี itemIds (id ของ playlist_tracks) — client ไม่มีทาง remove/reorder ได้จาก TrackDTO อย่างเดียว (design gap จับตอนเขียน test)
