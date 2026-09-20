# Phase 7 — WebSocket

Status: resolved

**Goal ตาม roadmap:** Realtime sync จริง — **DoD:** สอง tab — tab A สั่งเล่น tab B sync ทันที (< 500 ms); หลุด network 10 วินาทีแล้วเล่นต่อ + resync อัตโนมัติ
**Dependencies:** Phase 4–5 (มี state ให้ sync) ✓, Phase 6 ✓

## Evidence สรุป (2026-09-20)

- Tests: 198 เขียว (shared 35 + server 135 รวม ws.contract 11 + web 28); lint/format/typecheck
  ผ่านทุก workspace
- **DoD 1 ✓** two-tab sync = **63 ms** (< 500 ms) — tab B เห็นเพลง/สถานะ/คิว/history เปลี่ยนครบ
- **DoD 2 ✓** nginx outage 10 s: เสียงเล่นต่อ (163→196 s, paused:false), reconnect เอง ~3 s
  หลัง network กลับ + SYNC_REQUEST resync (ดู issues/04)

## ขอบเขต (websocket.md + roadmap Phase 7)

1. **Server:** Socket.IO บน path `/ws` ผูกกับ HTTP server ของ Fastify เดิม; handshake auth ด้วย JWT
   (`io({ auth: { token } })`); ทุก connection join room `user:{userId}` — event ถึงทุก tab/device ของ user
2. **Server → Client:** PLAYER_STATE_CHANGED, TRACK_STARTED, TRACK_ENDED, TRACK_EXCEPTION,
   QUEUE_UPDATED, QUEUE_ENDED, POSITION_UPDATED, VOLUME_CHANGED — ทุก event แนบ `version`
   (monotonic ต่อ user, เพิ่มทุกครั้งที่ emit; client ทิ้ง event version ต่ำกว่าที่ถือ)
   - RADIO_EXTENDED: ตัดทิ้งตาม websocket.md §3 (ใช้ QUEUE_UPDATED)
   - EQ_CHANGED / LIKES_CHANGED: ยังไม่มี feature EQ (Phase 8) / likes (Phase 10) — type ประกาศไว้แล้ว
     แต่ยังไม่มีจุด emit; จะเชื่อมตอน phase ของมัน
3. **Client → Server:** POSITION_SYNC (validate: เดินหน้าไม่เร็วกว่า real-time × 1.2, ≤ duration —
   ผิด → reject + POSITION_UPDATED กลับ), TRACK_ENDED (trigger advance + QUEUE_ENDED เมื่อหมดคิว),
   TRACK_STALLED (นับ ≥ 3 ครั้ง/30 s → TRACK_EXCEPTION + advance), SYNC_REQUEST (ตอบ
   PLAYER_STATE_CHANGED + QUEUE_UPDATED ล่าสุด)
4. **Web client:** socket.io-client — auto-reconnect (backoff 1s→30s), reconnect สำครั้ง → SYNC_REQUEST;
   apply event ตาม version gate; position sync ทุก 5 s ขณะเล่น + ตอน pause/seek/ended;
   เสียงเล่นต่อระหว่างหลุด (stream ไม่ได้วิ่งบน WS)
5. **Proxy:** vite dev proxy + nginx (`/ws` → server, upgrade headers)

## ออกแบบไว้แล้ว

- RealtimeHub: wrapper รอบ io Server — `emitToUser(userId, event, payload)` ใส่ version ให้เอง;
  PlayerService รับ dep `broadcaster?` (interface เดียวกัน) → emit จากใน mutation (มี context ครบ)
  contract test inject fake broadcaster ได้
- wsServer: สร้างใน buildApp (attach กับ `app.server` — มีตั้งแต่ก่อน listen) → test แบบ listen port 0
  - socket.io-client จริง (hermetic — ไม่แตะ DB/YouTube)
- AudioEngine เพิ่ม `applyRemote*` (player state / track started / position / volume) — กติกากันชน:
  event ที่ตรงกับสิ่งที่ tab นี้ทำอยู่ = no-op; remote track ใหม่ → โหลดสตรีมเลย (ไม่ยิง REST กลับ)

## ตัดสินผ่าน (non-gols)

- watchdog "stale" (websocket.md §6): เก็บ lastSyncAt ไว้แล้วใน PlayerService แต่ยังไม่ทำ timer ตัดสิน —
  จำเป็นจริงตอน Phase 11 (restore หลัง reconnect) ค่อยทำ
- Redis adapter / หลาย instance: ยัง single instance (Phase 13)
