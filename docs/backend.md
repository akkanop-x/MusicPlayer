# Backend Architecture

> Node.js + Fastify + TypeScript, Layered architecture (Controller → Service → Repository → DB)
> Socket.IO mount บน HTTP server เดียวกับ REST (เนื่องจาก WS ต้องแชร์ auth context)

---

## 1. Layers

```text
apps/server/src/
├── routes/                  # Layer 1: Controller (HTTP)
│   ├── auth.routes.ts
│   ├── search.routes.ts
│   ├── tracks.routes.ts
│   ├── playlists.routes.ts
│   ├── likes.routes.ts
│   ├── history.routes.ts
│   ├── queue.routes.ts
│   ├── player.routes.ts
│   ├── stream.routes.ts
│   ├── settings.routes.ts   # รวม EQ presets
│   └── radio.routes.ts
├── services/                # Layer 2: Business logic (ไม่รู้จัก HTTP)
│   ├── AuthService.ts
│   ├── SearchService.ts
│   ├── PlayerService.ts
│   ├── QueueService.ts
│   ├── PlaylistService.ts
│   ├── HistoryService.ts
│   ├── LikeService.ts
│   ├── SettingsService.ts
│   ├── RecommendationService.ts
│   ├── StreamService.ts
│   └── lavalink/
│       └── LavalinkClient.ts    # HTTP client ไป Lavalink (คนเดียวที่รู้จัก Lavalink)
├── repositories/            # Layer 3: Data access (Drizzle ORM — ไม่มี business logic)
│   ├── users.repo.ts
│   ├── tracks.repo.ts
│   ├── playlists.repo.ts
│   ├── likes.repo.ts
│   ├── history.repo.ts
│   ├── settings.repo.ts
│   └── queueSnapshot.repo.ts
├── ws/                      # WebSocket (Socket.IO)
│   ├── io.ts                   # server setup + auth middleware
│   ├── handlers.ts             # client→server events
│   └── emitters.ts             # server→client events (ใช้จาก services)
├── domain/                  # Types + pure logic ที่ไม่ผูก layer
│   ├── playerState.ts          # state machine (แชร์ logic กับ frontend ผ่าน packages/shared)
│   └── queueLogic.ts           # shuffle/repeat/previous pure functions
├── plugins/                 # Fastify plugins (auth guard, rate limit, error handler)
├── config/                  # env parsing (zod) + DI container
└── index.ts
```

**กฎ dependency:** `routes → services → repositories` เท่านั้น (ทางเดียว); services คุยกันเองได้ผ่าน interface; ห้าม repository เรียก service

## 2. ความรับผิดชอบของแต่ละ Service

### AuthService
- สมัคร/ล็อกอิน (argon2 hash), issue access token (short-lived JWT in memory) + refresh token rotation (httpOnly cookie)
- Guard สำหรับ routes (`requireAuth`) + WS handshake auth
- รายละเอียด: [ADR-006](./adr/006-authentication.md), security.md

### SearchService
- รับ query → เรียก `LavalinkClient.loadtracks()` ด้วย prefix ของ source ที่เปิด
- Normalize `Track` ของ Lavalink → `TrackDTO` ของเรา → upsert `tracks` table (dedupe ด้วย `source_name + source_identifier`)
- Merge ผลจาก local library (query `tracks` table) + Lavalink แล้วเรียงตาม relevance อย่างง่าย
- Fail-soft: ถ้า Lavalink ล่ม ตอบเฉพาะผล local + บอกว่า source ใดใช้ไม่ได้

### StreamService ⚠️ (ความปลอดภัยไว้สูงสุด — ดู security.md §Stream Proxy)
- `resolveStreamUrl(trackId)`: track ชนิด `youtube|soundcloud` (**source หลัก MVP — ADR-008**) → ถาม resolver service (แยก container); ชนิด `http` → URL ตรง; ชนิด `local` → ไฟล์ใน media volume (**Phase 14 fallback เท่านั้น**)
- `proxyStream(trackId, rangeHeader)`: ดึง bytes จาก source แล้ว pipe กลับ client พร้อม 206/Content-Range
- **SSRF guards:** allowlist ของ source hosts + บล็อก private/link-local IP (resolve DNS แล้วตรวจก่อน connect) + จำกัด redirect + จำกัดขนาด content-length

### PlayerService
- ถือ **player state machine ต่อ user** (ดู player.md): idle/loading/playing/paused/buffering/ended/error
- รับคำสั่ง (play/pause/seek/skip/previous/volume) → เปลี่ยน state → broadcast WS event → บันทึก position snapshot
- รับ playback events จาก client (`POSITION_SYNC`, `TRACK_STALLED`, `TRACK_ENDED`) พร้อม sanity check (เช่น position วิ่งเร็วเกินจริง → ปฏิเสธ)
- เมื่อ `TRACK_ENDED` → สั่ง QueueService.advance() → ถ้าไม่มีเพลงและ autoplay เปิด → ขอ RecommendationService → push `QUEUE_UPDATED`

### QueueService
- โครงสร้าง: `history` (stack) + `upcoming` (list) ต่อ user — ดู queue.md
- Operations: add, addNext, remove, move, clear, shuffle, unshuffle, skip, previous; repeat ผูกกับ PlayerService
- Persist: snapshot ลง DB (`queue_snapshots` / `queue_items`) ทุกครั้งที่ mutate — restore ได้หลัง restart
- Emit `QUEUE_UPDATED` หลังทุก mutation

### PlaylistService
- CRUD playlist + reorder/add/remove tracks (ธุรกรรม: อัปเดต `position` ทั้งชุด)
- "เล่น playlist" = ขอ QueueService แทนที่ upcoming ด้วยเพลงของ playlist

### HistoryService
- บันทึก listening event (trackId, playedAt, msPlayed, skipped) — เกณฑ์: จบเพลง หรือเล่น ≥ 30 s
- Query แบบ timeline + pagination (cursor-based)

### LikeService
- Like/unlike + รายการ liked; sync ข้ามอุปกรณ์ผ่าน WS `LIKES_CHANGED`

### SettingsService
- user_settings (volume, autoplay, theme...) + EQ presets (system presets + custom ต่อ user)

### RecommendationService
- Interface `RecommendationProvider` (ดู recommendation.md): MVP = `RuleBasedProvider`
- ให้ 2 โหมด: `getHomeFeed(userId)` และ `getRadioTracks(seed, exclude, limit)` สำหรับ autoplay/radio

## 3. การสื่อสารระหว่าง Services

- Sync method calls ผ่าน constructor-injected interfaces (ไม่มี event bus ภายใน — ไม่จำเป็นใน MVP)
- Service ที่ต้อง broadcast WS จะรับ `Emitter` interface (ไว้พอร์ตเป็น Socket.IO ใน MVP, เปลี่ยนได้)

## 4. Error Handling

- ทุก route ผ่าน central error handler → โครงสร้าง error เดียว: `{ error: { code, message, details? } }`
- Error codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE` (Lavalink/source), `TRACK_UNPLAYABLE`, `INTERNAL`
- ไม่เคย return stack trace / รายละเอียด infra ให้ client

## 5. Configuration & Environment

- Env ทั้งหมดผ่าน zod schema ตอน boot (fail-fast): `DATABASE_URL`, `LAVALINK_URL`, `LAVALINK_PASSWORD`, `RESOLVER_URL`, `JWT_SECRET`, `REFRESH_SECRET`, `CORS_ORIGIN`, `PORT` (`MEDIA_DIR` เฉพาะ Phase 14 เมื่อเปิด local fallback)
- ค่า secret มาจาก `.env` (dev) / secrets manager (prod) — ไม่ commit ลง repo (ดู security.md)

## 6. Assumptions

1. 1 process (ไม่ cluster) ใน MVP — player/queue state ใน memory + snapshot DB; ย้ายไป Redis เมื่อ scale (architecture.md §Scaling)
2. เวลาของ server และ client ใช้ NTP ใกล้เคียงกันพอสำหรับ position sanity check

## 7. Open Questions

1. ควรแยก `stream.routes.ts` ออกเป็น process ของตัวเอง (stream worker) ตั้งแต่ MVP เพื่อไม่ให้ proxy กิน event loop? — ค่าเริ่มต้น: ไม่แยก, ใช้ stream pipe ซึ่ง Node ทำได้ดีอยู่แล้ว แล้วค่อยแยกเมื่อวัดแล้วจำเป็น
2. Validation library: ใช้ zod ร่วมกับ Fastify schema หรือ TypeBox? (ค่าเริ่มต้น: zod — แชร์ schema กับ frontend ได้)

## 8. Risks

| Risk                                   | บรรเทา                                            |
|----------------------------------------|----------------------------------------------------|
| Player state ใน memory หายเมื่อ restart | Snapshot ทุก mutation + restore ตอน boot            |
| Stream proxy บล็อก event loop ของ API  | Pipe (backpressure ของ Node stream), วัดตั้งแต่ Phase 3, แยก process ได้ภายหลัง |
| Logic shuffle/repeat ซ้ำซ้อน client/server | เขียนเป็น pure functions ใน `packages/shared` ใช้สอยสองฝั่ง |
