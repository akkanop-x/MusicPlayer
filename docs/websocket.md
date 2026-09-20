# WebSocket Events (Socket.IO)

> Transport: Socket.IO บน path `/ws` (WSS ใน production)
> เหตุผลที่เลือก Socket.IO แทน raw WS: auto-reconnect + ack + rooms สำเร็จรูป — รายละเอียดใน [ADR-004](./adr/004-websocket.md)
> ทุก user อยู่ใน room `user:{userId}` — events ส่งถึงทุก connection ของ user (รองรับ multi-tab ตั้งแต่ต้น)

---

## 1. Authentication

- Handshake ต้องแนบ access token: `io({ auth: { token } })` → middleware ตรวจ JWT
- ถ้า token หมดอายุกลาง session: client ได้ `connect_error` → ทำ refresh (REST) → reconnect ใหม่
- ไม่มี event ไหนใช้งานได้แบบ anonymous

## 2. รูปแบบ Payload ร่วม

- ทุก server→client event ที่เกี่ยวกับ state แนบ `version: number` (เพิ่มขึ้นทุกครั้งที่ state เปลี่ยน ต่อ user) — client ทิ้ง event ที่ `version` ต่ำกว่าที่ตนถืออยู่ (กัน out-of-order)
- เวลาเป็นมิลลิวินาที

## 3. Server → Client Events

### `PLAYER_STATE_CHANGED`

| ฟิลด์   | ค่า                                                      |
|---------|-----------------------------------------------------------|
| Payload | `{ state, track?, positionMs, version }`                  |
| Trigger | ทุก transition ของ player state machine (player.md)       |
| Consumer| playerStore (frontend) — อัปเดต UI + AudioEngine ตาม state |

### `TRACK_STARTED`

| ฟิลด์   | ค่า                                                        |
|---------|-------------------------------------------------------------|
| Payload | `{ item: QueueItemDTO, positionMs: 0, version }`            |
| Trigger | เริ่มเล่นเพลงใหม่ (play, skip, previous, autoplay, repeat one) |
| Consumer| AudioEngine โหลด `/stream/:trackId` + playerStore           |

### `TRACK_ENDED`

| ฟิลด์   | ค่า                                                                 |
|---------|----------------------------------------------------------------------|
| Payload | `{ item: QueueItemDTO, reason: 'completed'|'skipped'|'error'|'replaced', version }` |
| Trigger | เพลงจบตามธรรมชาติ (client รายงาน) / skip / error → เปลี่ยนเพลง        |
| Consumer| playerStore (ทำความสะอาด UI), HistoryService (ภายใน backend ฟังเอง) |

### `TRACK_EXCEPTION`

| ฟิลด์   | ค่า                                                         |
|---------|--------------------------------------------------------------|
| Payload | `{ item, code: 'UNPLAYABLE'|'SOURCE_ERROR'|'CODEC_UNSUPPORTED', message, version }` |
| Trigger | StreamService ตรวจพบเพลงเล่นไม่ได้ หรือ client รายงาน STALLED จนหมด retry |
| Consumer| UI toast "ข้ามเพลงนี้เพราะเล่นไม่ได้"; playerStore           |

### `QUEUE_UPDATED`

| ฟิลด์   | ค่า                                                            |
|---------|-----------------------------------------------------------------|
| Payload | `{ queue: QueueStateDTO }` (ทั้งก้อน — replace, ไม่ diff)       |
| Trigger | ทุก mutation ของ queue (add/remove/move/clear/shuffle/skip/autoplay/radio) |
| Consumer| queueStore — replace state; ใช้ `version` ใน payload เป็นเกณฑ์   |

### `QUEUE_ENDED`

| ฟิลด์   | ค่า                                                              |
|---------|-------------------------------------------------------------------|
| Payload | `{ version }`                                                       |
| Trigger | เพลงสุดท้ายจบ + repeat=off + autoplay ปิด (หรือ recommendation หมด) |
| Consumer| UI แสดง "จบคิวแล้ว", player → IDLE                                 |

### `POSITION_UPDATED`

| ฟิลด์   | ค่า                                             |
|---------|--------------------------------------------------|
| Payload | `{ positionMs, version }`                        |
| Trigger | backend ปรับ position เพราะเหตุการณ์ฝั่ง server (seek, restore หลัง reconnect) — **ไม่**ใช่ broadcast ต่อเนื่อง |
| Consumer| playerStore — เฉพาะเมื่อต่างจาก local เกิน 500 ms |

> ระบบไม่ push position ทุกวินาที — client นับเองจาก AudioEngine (เสียงอยู่ที่ client จึงแม่นกว่า) และส่ง `POSITION_SYNC` กลับมาแทน

### `VOLUME_CHANGED`

| ฟิลด์   | ค่า                                        |
|---------|---------------------------------------------|
| Payload | `{ volume, muted, version }`                |
| Trigger | PATCH /player/volume (จากอีก tab/อุปกรณ์)   |
| Consumer| AudioEngine.setVolume + UI slider           |

### `EQ_CHANGED`

| ฟิลด์   | ค่า                                                     |
|---------|----------------------------------------------------------|
| Payload | `{ presetId | null, bands: number[] | null, version }`    |
| Trigger | PUT /eq/active, PATCH /eq/presets ที่เป็น active           |
| Consumer| eqGraph — apply bands แบบ smooth (equalizer.md)           |

### `LIKES_CHANGED`

| ฟิลด์   | ค่า                                                  |
|---------|-------------------------------------------------------|
| Payload | `{ trackId, liked: boolean }`                         |
| Trigger | PUT/DELETE like จากอุกอุปกรณ์อื่น                      |
| Consumer| TrackRow hearts, likes query cache invalidate         |

### `RADIO_EXTENDED` *(รวมใน QUEUE_UPDATED ก็ได้ — ตัดสินใจ: ใช้ QUEUE_UPDATED เพื่อลดจำนวน event type)*

> ตัดทิ้ง — radio extend สื่อสารผ่าน `QUEUE_UPDATED` เพียงพอ

## 4. Client → Server Events

### `POSITION_SYNC`

| ฟิลด์       | ค่า/กติกา                                                                 |
|-------------|---------------------------------------------------------------------------|
| Payload     | `{ positionMs }` (client ส่งทุก 5 s ขณะเล่น + ตอน pause/seek/ended)        |
| Validation  | server ตรวจ: ต้องเดินหน้าไม่เร็วกว่า real-time × 1.2, ≤ duration — ผิด → ปฏิเสธ + `SYNC_REQUEST` กลับ |
| ใช้ทำอะไร   | update authoritative position + snapshot; ประกอบเกณฑ์ history (ms_played)  |

### `TRACK_ENDED` (client report)

| ฟิลด์   | ค่า/กติกา                                              |
|---------|---------------------------------------------------------|
| Payload | `{ trackId, msPlayed }` — ack ต้องได้รับภายใน 5 s        |
| ใช้ทำอะไร | trigger QueueService.advance + history + autoplay      |

### `TRACK_STALLED`

| ฟิลด์   | ค่า/กติกา                                              |
|---------|---------------------------------------------------------|
| Payload | `{ trackId, positionMs, attempt }`                       |
| ใช้ทำอะไร | server นับ; ถ้าเกิน threshold (เช่น 3 reports / 30 s) → TRACK_EXCEPTION + advance |

### `SYNC_REQUEST`

| ฟิลด์   | ค่า/กติกา                                       |
|---------|--------------------------------------------------|
| Payload | `{ clientVersion? }`                              |
| Response| server ตอบกลับด้วย `PLAYER_STATE_CHANGED` + `QUEUE_UPDATED` ล่าสุด (ถ้า clientVersion ต่ำกว่า) |
| ใช้ทำอะไร | หลัง reconnect/refresh — resync ทั้งหมดในครั้งเดียว |

## 5. Retry / Reconnection Strategy (client side)

```text
disconnect
  → Socket.IO auto-reconnect (exponential backoff: 1s, 2s, 4s, ... max 30s)
  → reconnect สำเร็จ → emit SYNC_REQUEST → ได้ state ล่าสุด
  → ระหว่างเสีย connection: เสียงเล่นต่อ (stream ไม่ผ่าน WS), คำสั่งที่ fail ให้ retry ผ่าน REST
```

- ทุกคำสั่ง client→server ใช้ Socket.IO **ack + timeout** — ถ้าไม่ได้ ack ภายใน 5 s ถือว่า fail → ผ่าน REST แทน (REST เป็น fallback path เสมอ)
- Server ไม่ retry ส่ง event ที่หายไประหว่าง client หลุด — ใช้ `SYNC_REQUEST` เป็นกลไกเก็บกวาดแทน (เรียบง่ายกว่า event replay)

## 6. Heartbeat & Timeouts

- Socket.IO ping/pong default (25s/20s)
- Server-side: ถ้าไม่ได้รับ `POSITION_SYNC` ใด ๆ เกิน 60 s ขณะ state=playing → mark player `stale` (ไม่ broadcast) — ใช้ตัดสินใจตอน restore/sync ว่า position น่าเชื่อไหม

## 7. Ordering & Consistency

- Event ทั้งหมดต่อ user ถูก emit จาก thread เดียว (Node event loop) — เรียงตาม `version` อยู่แล้ว
- Client ต้อง handle: `TRACK_STARTED` มาก่อน `QUEUE_UPDATED` (skip) — ทำได้เพราะทั้งคู่แตะ state คนละส่วน

## 8. Assumptions

1. Events ต่อ user ไม่ถี่เกิน 10 events/s ในกรณีปกติ (buffering อาจส่ง STALLED ถี่ — มี threshold กัน sp am)
2. Multi-device: อุปกรณ์ที่สองที่เริ่มเล่น = อุปกรณ์แรกต้องหยุดเล่น (receive PLAYER_STATE_CHANGED แล้ว AudioEngine หยุด) — กติกา "ผู้เล่นคนล่าสุดชนะ"

## 9. Open Questions

1. ~~รายงาน buffering event ไป backend ไหม?~~ — **ไม่ทำใน MVP (grilling 2026-09-20):** แนบ field เสริมใน POSITION_SYNC ได้ในอนาคตเมื่อต้องการ metric จริง
2. "Party mode" (หลาย user ฟังด้วยกัน) — ยังไม่ออกแบบใน MVP; โครง room `user:{userId}` ต่อยอดเป็น `party:{id}` ได้
