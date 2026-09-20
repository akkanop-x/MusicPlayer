# Lavalink Integration

> ข้อเท็จจริงทั้งหมดอ้างอิงเอกสารทางการ **https://lavalink.dev** (Lavalink v4)
> บทบาทของ Lavalink ในโปรเจกต์นี้: **Track Resolution & Search Service เท่านั้น** — ไม่ใช่ตัวเล่น/ส่งเสียง (เหตุผล: [audio-pipeline.md](./audio-pipeline.md), [ADR-003](./adr/003-audio-pipeline.md))

---

## 1. Version

- **Lavalink v4** (major version ปัจจุบันตาม changelog ทางการ) — pin เป็น Docker image tag ล็อกเวอร์ชันรอง/patch ตอน Phase 2 เพื่อไม่ให้ minor update เลื่อนแบบไม่ตั้งใจ
- Runtime: JVM (Java 17+ ตาม requirement ของ v4; แนะนำใช้ Docker image ทางการซึ่งจัด JRE ให้แล้ว)
- Docker image ทางการ: `ghcr.io/lavalink-devs/lavalink:4` (เลือก tag เฉพาะเวอร์ชัน ไม่ใช้ `latest` ใน production)

## 2. Installation & Configuration

### 2.1 Docker Compose (สรุปโครง — ไฟล์จริงสร้างใน Phase 1/2)

```yaml
services:
  lavalink:
    image: ghcr.io/lavalink-devs/lavalink:4   # pin tag จริงใน Phase 2
    container_name: lavalink
    restart: unless-stopped
    environment:
      # ค่าจริงใส่ผ่าน .env — ห้าม hardcode ในไฟล์ที่ commit
      - _JAVA_OPTIONS=-Xmx512M
    volumes:
      - ./lavalink/application.yml:/opt/Lavalink/application.yml:ro
    ports:
      - "2333:2333"   # ต้อง bind เฉพาะ internal network ใน production
    networks: [internal]
```

### 2.2 application.yml (โครงสร้างหลัก)

```yaml
server:
  port: 2333
lavalink:
  server:
    password: "${LAVALINK_PASSWORD}"   # จาก env — backend ใช้ค่านี้ใน header Authorization
    sources:
      # แหล่ง built-in ที่เปิด (ระบุตามที่ใช้จริงเท่านั้น)
      bandcamp: true
      http: true          # direct HTTP streams (source `http`)
      local: true         # local files บน Lavalink host (เราไม่ใช้ — ไฟล์อยู่ฝั่ง backend)
      soundcloud: true
      twitch: false
      vimeo: false
      # youtube ไม่อยู่ใน core แล้ว — ต้องติดตั้ง youtube-source plugin (ดู §4)
    plugins: []           # ดู §4
plugins: {}
```

> ⚠️ ชื่อ key/โครงสร้างข้างต้นเป็นไปตามหมวด configuration ของ Lavalink v4 — **ก่อน implement ต้องเทียบกับ application.yml.example ของเวอร์ชันที่ pin ไว้อีกครั้ง** เพราะ config schema อาจปรับระหว่าง minor versions (นี่คือขั้นตอนบังคับใน Phase 2 ตาม roadmap)

### 2.3 Network Placement

- Lavalink อยู่ใน **internal Docker network เท่านั้น** — ไม่ expose port ออก internet
- มีเพียง backend (Node.js) ที่คุยกับ Lavalinkได้ (เชื่อมผ่าน `Authorization` header)
- Browser **ไม่มีทาง** เห็น/เรียก Lavalink โดยตรง

## 3. Connection Architecture

```text
Backend (Node.js)
  └── LavalinkClient (module ใน apps/server — เรียกผ่าน HTTP เท่านั้น)
        ├── GET  /v4/loadtracks?identifier=...
        ├── GET  /v4/decodetrack?encodedTrack=...
        ├── POST /v4/decodetracks
        └── GET  /v4/info, /v4/stats   (health check)
```

- ใช้เฉพาะ **REST** — เราไม่ใช้ระบบ WebSocket/session/player ของ Lavalink เลย เพราะไม่ได้เล่นผ่าน Discord voice (ระบบ session/player/voice ทั้งหมดผูกกับ Discord guild)
- ไม่ต้องมี Discord bot token ใด ๆ
- HTTP client ต้องตั้ง timeout (เช่น 10 s) + circuit breaker (ถ้า Lavalink ล่ม ให้ search fail-soft — ดู architecture.md §Failure Points)

## 4. Required Plugins

| Plugin                  | Maven coordinate / repo                  | ทำไมต้องใช้                                                             |
|-------------------------|-------------------------------------------|---------------------------------------------------------------------------|
| **youtube-source**      | `dev.lavalink.youtube:youtube-plugin` (repo `lavalink-devs/youtube-source`) | YouTube ถูกย้ายออกจาก Lavalink core แล้ว ต้องติดตั้งแยก จึงจะค้น `ytsearch:` / `ytmsearch:` ได้ |
| **LavaSrc**             | `com.github.topi314.LavaSrc:lavasrc-plugin` | **Spotify metadata** (`spsearch:`) — ค้นหา/import playlist จาก Spotify และใช้เป็น metadata ที่ดีกว่า YouTube; ต้องมี Spotify client credentials ใน config; ตอนเล่นจริง fallback ไป YouTube (Spotify ไม่มีเสียง) |

- ติดตั้งผ่าน `application.yml` (ส่วน `plugins` ของ Lavalink v4 รองรับดาวน์โหลดอัตโนมัติตามที่ระบุ) หรือวาง .jar ใน plugins dir — ตาม README ของแต่ละ plugin
- Spotify credentials เก็บใน env ของ Lavalink container — ห้าม hardcode (security.md)
- **หมายเหตุความจริง:** แม้ติด youtube-source แล้ว `loadtracks` ก็คืนแค่ metadata + `encoded` — **ไม่ใช่ stream URL** การเล่นใน browser ต้องผ่าน StreamService + resolver ของเราเสมอ ([ADR-008](./adr/008-youtube-first-no-local-storage.md)) — Lavalink ไม่เล่นเสียงจริงให้เราเลยแม้แต่เพลงเดียว (มันส่งเสียงได้ทางเดียว: Discord voice)

## 5. Source Support (ที่เกี่ยวข้องกับเรา)

> **ตัดสินใจแล้ว (2026-09-20, [ADR-008](./adr/008-youtube-first-no-local-storage.md)):** YouTube/YTMusic เป็น **source หลักของ MVP** — Lavalink ใช้เฉพาะ search/metadata; การหา stream URL เพื่อเล่นเป็นหน้าที่ของ resolver service (แยก container) ไม่ใช่ Lavalink

| Source prefix ใน identifier | Source            | ใช้ใน MVP? | หมายเหตุ                                        |
|-----------------------------|-------------------|------------|--------------------------------------------------|
| `ytsearch:` / `ytmsearch:`  | YouTube / YT Music| ✅ **หลัก** | ต้องติดตั้ง youtube-source plugin (§4); stream URL มาจาก resolver |
| `spsearch:`                 | Spotify           | ✅ (metadata เท่านั้น) | ผ่าน LavaSrc — ค้นหา/import playlist; เสียงจริง fallback ไป YouTube; ต้องมี client credentials |
| `scsearch:`                 | SoundCloud        | ⏸ หลัง MVP | **เลื่อนออกจาก MVP** (grilling 2026-09-20) — resolver ออกแบบ pluggable เพิ่มทีหลังได้ |
| `bcsearch:` (Bandcamp)      | Bandcamp          | พิจารณา    | —                                                 |
| (ไม่มี prefix — ใส่ URL ตรง) | HTTP audio URL    | พิจารณา    | ผ่าน resolver/proxy เสมอ                         |
| (ไม่มี prefix — local path) | Local file        | ⏸ Phase 14 (optional fallback) | ingest จาก disk — ไม่ใช่ critical path ของ MVP |

## 6. REST API ที่ใช้ (ของจริงตาม lavalink.dev/api/rest.html)

### 6.1 `GET /v4/loadtracks?identifier={identifier}`

- Header: `Authorization: {password}`
- Response:

```json
{
  "loadType": "track | playlist | search | empty | error",
  "data": {
    "encoded": "<base64>",
    "info": {
      "identifier": "...",
      "isSeekable": true,
      "author": "...",
      "length": 253000,
      "isStream": false,
      "position": 0,
      "title": "...",
      "uri": "https://...",        // source PAGE url — ไม่ใช่ stream url
      "artworkUrl": "https://...", // ถ้า source ให้มา
      "isrc": "...",               // ถ้ามี
      "sourceName": "http | youtube | soundcloud | ..."
    },
    "pluginInfo": {},
    "userData": {}
  }
}
```

- `loadType=track|search` → `data` (หรือ array) คือ Track object(s); `playlist` → playlist info + `tracks` array; `empty` → `data: null`; `error` → Exception object (`message`, `severity`)
- **เราเก็บอะไร:** title, author, length, isStream, isSeekable, uri, artworkUrl, isrc, sourceName, identifier → ใส่ใน table `tracks` (เก็บ `encoded` ด้วยเพื่อใช้ reference ย้อนกลับ แต่**ไม่ใช้**เล่นใน Lavalink player)

### 6.2 Endpoints อื่นที่ใช้

| Endpoint                        | ใช้ทำอะไร                                    |
|---------------------------------|-----------------------------------------------|
| `GET /v4/decodetrack?encodedTrack=` | แปลง encoded string → info (utility/debug)  |
| `POST /v4/decodetracks`          | decode หลายเพลงพร้อมกัน                      |
| `GET /v4/info`                   | health check + ดู version/plugins ที่โหลด    |
| `GET /v4/stats`                  | ดูหน่วยความจำ/CPU สำหรับ monitoring          |

### 6.3 Endpoints ที่ **ไม่ใช้** (เก็บกว้างๆ ไว้กันสับสน)

- `PATCH /v4/sessions/{id}`, `/v4/sessions/{id}/players/*`, `routeplanner/*` — ทั้งหมดนี้เป็นระบบ session/player สำหรับเล่นผ่าน **Discord voice** ซึ่งเราไม่ใช้ (ไม่มี guild, ไม่มี voice token)

## 7. Track Lifecycle (ในมุมของเรา)

```text
[ค้นหา/วางลิงก์]
   → SearchService เรียก loadtracks
   → normalize เป็น TrackDTO → upsert ลง PostgreSQL (dedupe ด้วย sourceName+identifier)
   → ผู้ใช้เพิ่มเข้า queue / เล่น
   → StreamService resolve stream URL (ไม่เกี่ยวกับ Lavalink อีกแล้ว)
   → เพลงถูกอ้างถึงด้วย trackId ของเราเองตลอดหลังจากนี้
```

- Lavalink เป็น **stateless จากมุมมองเรา** — ไม่มี session ต้องดูแล, restart Lavalink ไม่กระทบ playback ที่กำลังเล่น (กระทบแค่ search ช่วงที่มันล่ม)
- Track metadata cache ใน `tracks` table มี `resolvedAt`; ถ้า `artworkUrl` หมดอายุ/404 ให้ re-resolve ผ่าน Lavalink อีกครั้งแบบ background

## 8. Error Handling

| สถานการณ์                    | สิ่งที่ทำ                                                     |
|------------------------------|------------------------------------------------------------------|
| `loadType=error`             | Log + map `severity` → HTTP error ของเรา (เช่น 502 BAD_UPSTREAM) |
| `loadType=empty`             | ตอบ search 200 พร้อม empty result (ไม่ใช่ error)                 |
| Connection refused / timeout | Circuit breaker เปิด → search ตอบ 503 + fallback เฉพาะ local library |
| 4xx/5xx อื่นจาก Lavalink     | Log + wrap เป็น UpstreamError + ไม่ leak รายละเอียดให้ client    |

## 9. Limitations & Assumptions

1. **Lavalink ไม่มีผลกับเสียงที่ผู้ใช้ได้ยินเลย** — มันคือ "ตัวตอบคำถามว่าเพลงที่ว่านี่คืออะไร" เท่านั้น
2. `uri` จาก Lavalink ไม่สามารถโปรแกรงลง `<audio>` ได้โดยตรง (เป็น page URL + CORS) — ต้องผ่าน StreamService เสมอ
3. ค่า `length` เป็นมิลลิวินาที; `isStream=true` ไม่มีความยาว
4. Config schema ของ Lavalink/plugins เปลี่ยนได้ระหว่าง version — ต้อง verify ตอน Phase 2

## 10. Open Questions

1. ~~เปิด SoundCloud ตั้งแต่ MVP หรือรอ?~~ — **ตัดสินใจแล้ว (grilling 2026-09-20): เลื่อนออกจาก MVP** — เพิ่มภายหลังผ่าน resolver แบบ pluggable
2. ต้องใช้ LavaSearch (advanced search: artist/album grouping) ใน MVP ไหม? (ค่าเริ่มต้น: ไม่ — Spotify metadata + LavaSrc ตอบโจทย์ grouping ส่วนใหญ่แล้ว)
3. ~~Genre enrichment จาก provider ไหม?~~ — **ตัดสินใจแล้ว (grilling 2026-09-20): Spotify Web API เท่านั้น** (genre ระดับ artist, cache ใน `tracks.genres`) — ไม่ใช้ Last.fm; รายละเอียดใน database.md / recommendation.md
