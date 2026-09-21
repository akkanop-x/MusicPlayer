# 05 E2E J12 + ปิด phase

Status: resolved

- J12: home feed แสดง → ▶ เล่นได้ → 📻 เริ่ม radio → badge โชว์ (E2E 12 passed ครั้งแรก)
- Real-data DoD verify (demo account): radio จาก seed "One More Time (Radio Edit)" →
  current + 20 upcoming, dupes 0, genre violation 0 (ตรวจ genres ใน Postgres ทุก track)
- Gates: lint/format:check/typecheck เขียว · unit shared 45 / server 222 / web 72
- docker rebuild + asset hash ตรง container · commit/push · CI เขียว
