# 02 — Server: client→server events + validation

Status: resolved

- PlayerService เพิ่ม `syncPosition` / `reportTrackEnded` / `reportStalled`
- ws handlers พร้อม ack (timeout ฝั่ง client 5 s):
  - `POSITION_SYNC {positionMs}`: ต้องไม่เดินเร็วกว่า real-time × 1.2 (+1.5 s tolerance) และ
    ≤ duration — ผิด → ack `{ok:false}` + emit POSITION_UPDATED ให้ client กลับมาตรง
  - `TRACK_ENDED {trackId, msPlayed}`: ตรง current → advance ("completed"); คิวหมด repeat=off →
    ctx IDLE + emit QUEUE_ENDED (แทนการ throw NO_NEXT)
  - `TRACK_STALLED {trackId, positionMs, attempt}`: นับต่อ user ในหน้าต่าง 30 s — ครบ 3 →
    emit TRACK_EXCEPTION + advance
  - `SYNC_REQUEST {clientVersion?}`: emit PLAYER_STATE_CHANGED + QUEUE_UPDATED ล่าสุดกลับ socket นั้น

## Evidence (2026-09-20)

- ws.contract.test.ts: POSITION_SYNC ปกติ ack ok:true / กระโดด 120 s ใน 50 ms → ok:false +
  POSITION_UPDATED บอกตำแหน่งจริงกลับ; TRACK_ENDED advance ได้ TRACK_STARTED ของเพลงถัดไป,
  คิวหมด → QUEUE_ENDED + state IDLE; TRACK_ENDED ของ track อื่น → ended:false; STALLED
  3 ครั้ง/30 s → TRACK_EXCEPTION + advance

## Lessons learned

- หน้าต่าง 30 s ของ stalled เก็บ per user ใน UserPlayer แล้ว prune ตอน report ทุกครั้ง — ง่ายกว่า
  global Map แยก
