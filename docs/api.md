# REST API Design

> ทุก endpoint: versioned `/api/v1`, JSON, ต้องผ่าน Authentication เว้นแต่ระบุ `Public`
> Auth: `Authorization: Bearer <accessToken>` (access token อายุสั้น 15 นาที — ดู ADR-006)
> Error shape เดียวกันทั้งระบบ: `{ "error": { "code": "...", "message": "...", "details": {} } }`
> รายการ error codes อยู่ใน backend.md §4

---

## 1. Conventions

- `DTO` หลัก:

```ts
TrackDTO {
  id, title, artist, album, durationMs, isStream, isSeekable,
  artworkUrl, sourceName, isLiked   // isLiked เติมตอนผู้ใช้ล็อกอิน (แสดงหัวใจ)
}

QueueItemDTO { id, track: TrackDTO }

PlayerStateDTO {
  state: 'idle'|'loading'|'playing'|'paused'|'buffering'|'ended'|'error',
  track: TrackDTO | null,
  positionMs: number,
  volume: number, muted: boolean,
  repeatMode: 'off'|'one'|'all', shuffle: boolean, autoplay: boolean
}

QueueStateDTO {
  current: QueueItemDTO | null,
  upcoming: QueueItemDTO[],        // เรียง ถัดไป → สุดท้าย
  history: QueueItemDTO[],         // เรียง ใหม่ → เก่า
  version: number                  // ใช้เทียบกับ WS events (กัน stale)
}
```

- คำสั่ง player/queue ที่สำเร็จตอบ **200/202 + PlayerStateDTO หรือ QueueStateDTO** (ให้ client ไม่ต้องรอ WS เพื่อ update) — ยกเว้นระบุไว้ต่างหาก
- Playback ที่เปลี่ยนเพราะ client เอง (เช่น TRACK_ENDED) ถูกส่งทาง WS ไม่ใช่ REST

## 2. Auth

| # | Method | Path                | Auth   | Request                          | Response 200                    | Errors                        |
|---|--------|---------------------|--------|----------------------------------|----------------------------------|--------------------------------|
| 1 | POST   | `/auth/register`    | Public | `{ email, password, displayName }` | `{ accessToken }` + Set refresh cookie | 400 VALIDATION, 409 EMAIL_TAKEN |
| 2 | POST   | `/auth/login`       | Public | `{ email, password }`            | `{ accessToken }` + Set refresh cookie | 401 UNAUTHENTICATED, 429      |
| 3 | POST   | `/auth/refresh`     | Cookie | (refresh cookie)                 | `{ accessToken }` + rotate cookie | 401 (reuse หรือหมดอายุ → force login) |
| 4 | POST   | `/auth/logout`      | Cookie | (refresh cookie)                 | `204`                            | —                             |
| 5 | GET    | `/me`               | Bearer | —                                | `{ id, email, displayName }`     | 401                           |

## 3. Search & Tracks

| # | Method | Path                | Request / Query                  | Response 200                              | Errors            |
|---|--------|---------------------|----------------------------------|--------------------------------------------|-------------------|
| 6 | GET    | `/search`           | `?q=&limit=20&offset=0`          | `{ tracks: TrackDTO[], sources: {available, degraded[]} }` | 400, 503 UPSTREAM (บาง source) |
| 7 | GET    | `/tracks/:id`       | —                                | `TrackDTO`                                 | 404               |
| 8 | GET    | `/tracks` (batch)   | `?ids=a,b,c` (≤ 50)              | `{ tracks: TrackDTO[] }`                   | 400               |

## 4. Player

| #  | Method | Path                  | Request body              | Response 200          | Errors                     |
|----|--------|-----------------------|---------------------------|------------------------|-----------------------------|
| 9  | GET    | `/player`             | —                         | `PlayerStateDTO`       | 401                         |
| 10 | POST   | `/player/play`        | `{ trackId }` หรือ `{ queueItemId }` | `PlayerStateDTO` | 404 TRACK_NOT_FOUND        |
| 11 | POST   | `/player/pause`       | —                         | `PlayerStateDTO`       | 409 NOT_PLAYING            |
| 12 | POST   | `/player/resume`      | —                         | `PlayerStateDTO`       | 409 NOT_PAUSED             |
| 13 | POST   | `/player/seek`        | `{ positionMs }`          | `PlayerStateDTO`       | 400 (เกิน duration / stream), 409 |
| 14 | POST   | `/player/skip`        | —                         | `QueueStateDTO`        | 409 NO_NEXT                |
| 15 | POST   | `/player/previous`    | —                         | `PlayerStateDTO`       | 409 NO_PREVIOUS            |
| 16 | PATCH  | `/player/volume`      | `{ volume: 0-100 }`       | `PlayerStateDTO`       | 400                         |
| 17 | PATCH  | `/player/repeat`      | `{ mode: 'off'|'one'|'all' }` | `PlayerStateDTO`    | 400                         |
| 18 | PATCH  | `/player/shuffle`     | `{ enabled: boolean }`    | `QueueStateDTO`        | —                           |

> ทำไมเป็น POST/PATCH แยก file แทน PATCH `/player` เดียว: แต่ละ action มี transition rule และ error code ต่างกัน (player.md) — แยกชัดเจนกว่า generic PATCH ที่ validate ยาก

## 5. Queue

| #  | Method   | Path                    | Request body                        | Response          | Errors        |
|----|----------|--------------------------|--------------------------------------|---------------------|---------------|
| 19 | GET      | `/queue`                 | —                                    | `QueueStateDTO`     | 401           |
| 20 | POST     | `/queue/tracks`          | `{ trackIds: [] }` หรือ `{ playlistId }` หรือ `{ radioSeedTrackId }` | `QueueStateDTO` | 400, 404 |
| 21 | POST     | `/queue/tracks/next`     | `{ trackIds: [] }` (addNext)         | `QueueStateDTO`     | 400, 404      |
| 22 | PATCH    | `/queue/items/:id/move`  | `{ toPosition }`                     | `QueueStateDTO`     | 404, 400      |
| 23 | DELETE   | `/queue/items/:id`       | —                                    | `QueueStateDTO`     | 404           |
| 24 | DELETE   | `/queue`                 | `?scope=upcoming|all`                | `QueueStateDTO`     | 400           |

> การลบ queue item ที่กำลังเล่น: `DELETE /queue/items/:id` ตอบ 409 ให้ใช้ skip แทน (กัน ambiguity)

## 6. Stream (audio data path)

| #  | Method | Path                    | Request                       | Response                     | Errors                          |
|----|--------|--------------------------|-------------------------------|-------------------------------|----------------------------------|
| 25 | GET    | `/stream/:trackId`       | Header `Range: bytes=...` (ตาม spec HTTP) | `200` (ทั้งไฟล์) หรือ `206 Partial Content` + `Content-Type`, `Accept-Ranges: bytes`, `Content-Range`, `Content-Length` | 401, 404, 409 TRACK_UNPLAYABLE (codec/source ใช้ไม่ได้), 416 (range ผิด), 502 (source ล่ม) |

- Body: **audio bytes** (pipe จาก source/ไฟล์) — ไม่ใช่ JSON
- **Auth ของ endpoint นี้พิเศษ:** ใช้ **session cookie (httpOnly, SameSite=Strict)** แทน `Authorization: Bearer` — `<audio>` ขอ browser แนบ cookie ให้เองเมื่อ same-origin (ตัดสินใจตาม security.md §8.6: ปลอดภัย/เร็วที่สุด) — endpoint อื่นทั้งหมดยังใช้ Bearer ตามปกติ
- ไม่มี endpoint ไหนคืน `stream_url` ของ source จริงให้ client เด็ดขาด (SSRF/security: security.md)

## 7. Playlists

| #  | Method   | Path                              | Request                          | Response               | Errors          |
|----|----------|-----------------------------------|----------------------------------|-------------------------|-----------------|
| 26 | GET      | `/playlists`                      | —                                | `{ playlists: PlaylistDTO[] }` | 401       |
| 27 | POST     | `/playlists`                      | `{ name, description? }`         | `PlaylistDTO` (201)     | 400, 409 NAME_TAKEN |
| 28 | GET      | `/playlists/:id`                  | —                                | `PlaylistDTO { tracks: TrackDTO[] }` | 403, 404 |
| 29 | PATCH    | `/playlists/:id`                  | `{ name?, description? }`        | `PlaylistDTO`           | 403, 404        |
| 30 | DELETE   | `/playlists/:id`                  | —                                | `204`                   | 403, 404        |
| 31 | POST     | `/playlists/:id/tracks`           | `{ trackIds: [] , position? }`   | `PlaylistDTO`           | 403, 404        |
| 32 | DELETE   | `/playlists/:id/tracks`           | `{ itemIds: [] }` (body DELETE)  | `PlaylistDTO`           | 403, 404        |
| 33 | PATCH    | `/playlists/:id/tracks/order`     | `{ orderedItemIds: [] }`         | `PlaylistDTO`           | 403, 404, 400   |

## 8. Likes

| #  | Method   | Path                    | Request | Response          | Errors |
|----|----------|--------------------------|---------|----------------------|--------|
| 34 | GET      | `/likes`                 | `?limit&cursor` | `{ items: {track, likedAt}[], nextCursor? }` | 401 |
| 35 | PUT      | `/tracks/:id/like`       | —       | `{ trackId, liked: true }` | 404 |
| 36 | DELETE   | `/tracks/:id/like`       | —       | `{ trackId, liked: false }` | 404 |

> ใช้ PUT/DELETE (idempotent) แทน POST toggle — click ซ้ำไม่สร้างสถานะเพี้ยน

## 9. History

| #  | Method | Path                    | Query                       | Response                                     | Errors |
|----|--------|--------------------------|-----------------------------|-----------------------------------------------|--------|
| 37 | GET    | `/history`               | `?limit=50&before=<ISO>` (cursor) | `{ items: HistoryEntryDTO[], nextCursor? }` | 401    |

> การเขียน history เกิดจาก backend เอง (จาก playback events ผ่าน WS) ไม่มี POST `/history` จาก client

## 10. Settings & EQ

| #  | Method | Path                        | Request                         | Response            | Errors    |
|----|--------|------------------------------|----------------------------------|----------------------|-----------|
| 38 | GET    | `/settings`                  | —                                | `UserSettingsDTO`    | 401       |
| 39 | PATCH  | `/settings`                  | `{ volume?, muted?, autoplay? }` | `UserSettingsDTO`    | 400       |
| 40 | GET    | `/eq/presets`                | —                                | `{ presets: EqPresetDTO[] }` (system + custom) | 401 |
| 41 | POST   | `/eq/presets`                | `{ name, bands[10] }`            | `EqPresetDTO` (201)  | 400, 409  |
| 42 | PATCH  | `/eq/presets/:id`            | `{ name?, bands? }`              | `EqPresetDTO`        | 403, 404  |
| 43 | DELETE | `/eq/presets/:id`            | —                                | `204`                | 403, 404  |
| 44 | PUT    | `/eq/active`                 | `{ presetId | null }` (null=flat) | `UserSettingsDTO`  | 404       |

## 11. Radio / Recommendations

| #  | Method | Path                     | Request body / Query          | Response                          | Errors   |
|----|--------|--------------------------|-------------------------------|-------------------------------------|----------|
| 45 | GET    | `/recommendations`       | `?limit=20`                   | `{ tracks: TrackDTO[] }`            | 401      |
| 46 | POST   | `/radio/start`           | `{ seedTrackId }`             | `QueueStateDTO` (queue ถูกแทนด้วย radio) | 404 |
| 47 | POST   | `/radio/extend`          | — (ใช้ radio ปัจจุบัน)        | `QueueStateDTO` (เติมเพิ่ม ≥ 5 เพลง) | 409 NO_RADIO |

## 12. Rate Limiting (ค่าเริ่มต้น — จบใน security.md)

| กลุ่ม endpoint              | ขีดจำกัด                    |
|-----------------------------|------------------------------|
| `/auth/login`, `/auth/register` | 5 / นาที / IP + per-account lockout |
| `/search`                   | 30 / นาที / user             |
| คำสั่ง player/queue (POST/PATCH/DELETE) | 60 / นาที / user   |
| `/stream/:id`               | 60 requests / นาที / user + จำกัด concurrent streams ต่อ user ≤ 2 |

## 13. Assumptions

1. ไม่มี pagination แบบ offset ใน history/likes (ใช้ cursor) เพราะข้อมูล insert ตลอด
2. `POST /player/play` ด้วย `{ trackId }` = เล่นทันทีและแทนที่ upcoming (Spotify behavior); การ "เพิ่มใน queue" ใช้ `/queue/tracks`

## 14. Open Questions

1. ~~`DELETE /playlists/:id/tracks` ใช้ body หรือ POST variant?~~ — **ตัดสินใจแล้ว (grilling 2026-09-20): คง DELETE + body** — ระบบส่วนตัวผ่าน reverse proxy ของเรา ไม่มี client/proxy ที่ตัด body; เพิ่ม POST variant ภายหลังได้ถ้าเจอปัญหาจริง
2. ใช้ ETag/If-None-Match สำหรับ `/queue`, `/player` ไหม? (ค่าเริ่มต้น: ไม่ — ใช้ `version` ใน payload แทน)
