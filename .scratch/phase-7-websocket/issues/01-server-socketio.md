# 01 — Server: Socket.IO + auth handshake + rooms + emit จาก PlayerService

Status: resolved

- shared: `packages/shared/src/realtime.ts` — event name constants + payload types (websocket.md §2–4)
- `apps/server/src/realtime/RealtimeHub.ts` — `emitToUser(userId, event, payload)` → room
  `user:{userId}` + แนบ `version` (monotonic ต่อ user เพิ่มทุก emit)
- `apps/server/src/realtime/wsServer.ts` — `attachRealtime()`: io บน `app.server` path `/ws`,
  middleware verifyJwt (handshake.auth.token หรือ Authorization header) → join room
- PlayerService dep เพิ่ม `broadcaster?` → emit เหตุการณ์จากทุก mutation (play/pause/resume/seek/
  skip/previous/volume/repeat/shuffle/queue ops) ตาม websocket.md §3
- proxy: vite dev `/ws` (ws:true) + nginx `/ws/` upgrade headers

## Evidence (2026-09-20)

- `ws.contract.test.ts` ผ่าน 11 tests: connect_error เมื่อไม่มี/token พัง; token ดี → connected;
  REST play จาก client หนึ่ง → ทุก client ของ user เดียวกันได้ TRACK_STARTED + QUEUE_UPDATED +
  PLAYER_STATE_CHANGED; user อื่น (room ต่างกัน) ไม่ได้ event; version เดิน monotonic;
  PATCH volume → VOLUME_CHANGED ทุก tab
- lint/typecheck เขียวทุก workspace

## Lessons learned

- Fastify สร้าง HTTP server จริง **ตอน `listen()`** — `app.server` ก่อนหน้านั้น attach socket.io
  ไม่ได้ → ต้อง attach ใน `onListen` hook (และ hook นี้ fastify เรียก `fn.call(server)` **ไม่ส่ง
  args** — instance ต้องใช้ผ่าน `this`)
- บทเรียน debug: เช็คเงื่อนไข injection ให้ครบก่อนสงสัย library — เสียเวลาไปกับ engine.io attach
  ทั้งที่ block `if (deps.player || deps.db)` ไม่เคยรวม `playerRepos` เลย (hook/routes ไม่ถูก
  register)
