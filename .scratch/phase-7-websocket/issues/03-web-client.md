# 03 — Web: socket client + reconnect + SYNC_REQUEST + apply events

Status: resolved

- dep `socket.io-client`; `apps/web/src/realtime/socketClient.ts`:
  - connect หลัง auth hydrate / login (App root effect keyed on token — navigate ไม่หลุด)
  - auto-reconnect backoff 1 s→30 s; `connect` ทุกครั้ง → emit SYNC_REQUEST
  - connect_error UNAUTHENTICATED → tryRefresh (REST) แล้ว reconnect ด้วย token ใหม่
  - emit helper ack timeout 5 s: positionSync / reportTrackEnded / reportStalled
  - `window.__rt` debug hook (connected/lastEvent/lastEventAt/simulateNetworkDrop) สำหรับ E2E
- `realtime/handlers.ts` — version gate (ทิ้ง event เก่า/ซ้ำ) แล้ว dispatch: PLAYER_STATE_CHANGED /
  TRACK_STARTED → AudioEngine.applyRemote*, QUEUE_UPDATED → queueStore, POSITION_UPDATED
  (engine กรองต่าง > 500 ms เอง), VOLUME_CHANGED, TRACK_EXCEPTION → toast, QUEUE_ENDED → IDLE
- AudioEngine: `applyRemotePlayerState/applyTrackStarted/applyRemotePosition/applyRemoteVolume`;
  กติกา no-op เมื่อ tab ผู้สั่งได้ event กลับ (เทียบ track id จาก audio.src); POSITION_SYNC ทุก
  5 s ขณะเล่น + ตอน pause/seek/ended; ended → WS TRACK_ENDED (fallback REST skip); stalled →
  WS TRACK_STALLED
- proxy: vite `/ws` (ws:true) + nginx `/ws/` upgrade headers — ทดสอบผ่านทั้งคู่

## Evidence (2026-09-20)

- web vitest 28 tests (เพิ่ม handlers 8 + socketClient 6): version gate ทิ้ง event เก่า/ซ้ำ;
  dispatch ครบทุก event; ack timeout → null; SYNC_REQUEST ตอน connect; token หมด → ไม่ connect
- browser จริง: ทั้งสอง tab `__rt.connected = true` และได้ QUEUE_UPDATED จาก SYNC_REQUEST แรก

## Lessons learned

- event ที่ tab ผู้สั่งได้รับกลับมาเองต้อง no-op ได้ (เทียบ trackId จาก src) — TRACK_STARTED
  broadcast มาถึง**ก่อน** REST response ด้วย จึงต้อง guard ใน play() ไม่รีโหลด src ซ้ำ
