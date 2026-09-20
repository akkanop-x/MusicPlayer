# 04 — Smoke E2E multi-tab + network drop + ปิด Phase

Status: resolved

- docker compose rebuild server+web; browser จริง (IAB) เปิด 2 tab ที่ localhost:8080
- DoD 1: tab A กด play → tab B เห็นเพลง/สถานะเปลี่ยน < 500 ms
- DoD 2: หลุด network 10 s → เสียงเล่นต่อ → reconnect เอง + SYNC_REQUEST resync
- ปิด tracker + commit/push + CI เขียว

## Evidence (2026-09-20)

- **DoD 1 ✓** tab A กด "เล่นอีก" Instant Crush (REST play) → tab B ได้ event ภายใน
  **63 ms** (`__rt.lastEventAt - window.__t0` เทียบ Date.now() ข้าม tab ได้เพราะเครื่องเดียวกัน);
  UI ของ tab B เปลี่ยนครบ: PlayerBar = Instant Crush + ปุ่ม ⏸ (playing) + ตำแหน่งเดิน 0:22,
  history เพิ่ม, คิวถูก replace ตาม playNow
- **DoD 2 ✓** `docker compose stop web` (nginx — ตัด WS + stream ผ่าน proxy จริง):
  - ระหว่างหลุด 8 s: `connected:false`, เสียงเล่นต่อจาก buffer (163 s, paused:false)
  - `docker compose start web` → client reconnect เองภายใน ~3 s (backoff 1s→2s→4s) →
    SYNC_REQUEST → ได้ QUEUE_UPDATED (resync), เสียงเดินต่อ 196 s ไม่หยุด
  - ทดสอบเสริม `__rt.simulateNetworkDrop()` (engine.close — transport ตายแบบ network จริง,
    server ยังอยู่): reconnect + resync ภายใน ~1 s, เสียงเล่นต่อ 73→95 s
- CI: run (กรอกหลัง push) success

## Lessons learned

- nginx stop = outage จริงที่ครอบคลุมกว่า restart server (server restart จะ wipe player state
  in-memory และ restore เป็น PAUSED จาก snapshot — ทำให้วัด "เล่นต่อ" ไม่ตรง DoD)
- socket.io auto-reconnect กับ outage 10 s: attempt ที่ +1s/+2s/+4s/+8s พลาดหมด → สำเร็จ
  ~2-4 s หลัง network กลับ — ตรง spec websocket.md §5
- กติกา websocket.md §8 "ผู้เล่นล่าสุดชนะ" ข้ามอุปกรณ์ (อีก tab ควรหยุดเมื่ออีกเครื่องเริ่มเล่น)
  ยังไม่ implement — ตอนนี้ทุก tab เล่นเสียงตาม state (sync เต็มรูปแบบ); เลื่อนไปตอนมี
  multi-device จริง (Phase 9+) พร้อม active-device indicator
