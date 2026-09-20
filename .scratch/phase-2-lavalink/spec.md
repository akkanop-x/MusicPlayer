# Spec: Phase 2 — Lavalink Integration

> Roadmap: docs/roadmap.md §Phase 2 · References: docs/lavalink.md, docs/api.md §3, docs/backend.md, ADR-008

## Goal

Backend คุยกับ Lavalink ได้จริง — ครั้งแรกที่ "ความจริงเจอกับเอกสาร" (verify ทุก claim ใน docs/lavalink.md กับ Lavalink container จริง)

## Scope

1. **Pin + verify config** — Lavalink v4 image pin เป็นเวอร์ชันจริง; application.yml เทียบกับ application.yml.example ของเวอร์ชันที่ pin (lavalink.md §2.2 บังคับ)
2. **youtube-source plugin** — source หลัก MVP (`ytsearch:`/`ytmsearch:`) ตาม ADR-008
3. **LavaSrc plugin + Spotify client credentials** — `spsearch:` metadata เท่านั้น; credentials ผ่าน env เท่านั้น (ห้าม hardcode)
4. **LavalinkClient** — loadtracks + decodetrack + GET /v4/info (health) + timeout 10 s + circuit breaker (REST เท่านั้น ไม่ใช้ WS/session ของ Lavalink)
5. **SearchService + tracks.repo.upsert** — normalize Lavalink Track → TrackDTO → upsert `tracks` (dedupe `source_name + source_identifier`)
6. **`GET /api/v1/search`** — ตอบ `{ tracks: TrackDTO[], sources: { available, degraded[] } }`
7. **Contract tests** — mock Lavalink ครบ 5 loadTypes (track/search/playlist/empty/error) + circuit breaker/timeout unit tests
8. **Smoke test** — กับ container จริง: `GET /v4/info` ผ่าน, `ytsearch:` คืนผล, `spsearch:` คืนผล (ต้องมี credentials)

## ข้อตัดสินใจ (triage 2026-09-20)

- **Lavalink 4.2.2, youtube-source 1.18.2, LavaSrc 4.8.3** (ตรวจจาก GitHub releases จริง — 4.2.2 ล่าสุด ณ วันที่นี้)
- Config จริงของ 4.2.2 ต่างจาก docs: `youtube: false` ใน example (built-in deprecated), sources มี `nico`, plugin ประกาศที่ `lavalink.plugins` + plugin-config ที่ root `plugins:` (README LavaSrc: "YES plugins IS AT ROOT")
- **LavaSrc เปิด `sources.spotify: true` เสมอ** ถึงแม้ credentials ว่าง — ตรวจ source แล้ว constructor ไม่ throw ตอน boot (token ไป fetch ตอน query); `spsearch:` โดยไม่มี credentials จะได้ loadType=error → fail-soft ตามปกติ
- Spring placeholder รองรับ default: `"${SPOTIFY_CLIENT_ID:}"` → ค่าว่างได้
- แหล่ง search ใน Phase 2: 1 source ต่อ request (`?source=yt|ytm|sp`, default `yt`) — การ merge หลาย source + library local + Spotify playlist import เป็น Phase 6
- `loadType=error` และ Lavalink ล่ม → **503 `UPSTREAM_UNAVAILABLE`** (Phase 2 ยังไม่มี local library ให้ fallback — ตาม DoD "503 + error ชัดเจน"); การตอบ local-only ทำใน Phase 6
- **ยังไม่มี auth guard** — ระบบ auth ยังไม่ implement (ไม่อยู่ใน phase ไหนจนถึง P6+); route เป็น public ชั่วคราว, ใส่ comment ไว้ใน route
- `isLiked` ใน TrackDTO = false เสมอใน Phase 2 (LikeService เป็น Phase 10)

## Out of scope (ตัดชัดเจน)

- Stream/proxy เสียงทั้งหมด (Phase 3 — StreamService, resolver, SSRF guards)
- Spotify Web API genre enrichment (Phase 3 ตาม roadmap)
- SoundCloud `scsearch:` (เลื่อนออกจาก MVP แล้ว — lavalink.md §5)
- Spotify playlist import, library search merge, pagination/debounce UI (Phase 6)
- Rate limiting `/search` 30/min (ทำตอน security hardening — Phase 13)
- decodetracks (POST หลายเพลง) — ยังไม่มี use case จริง

## DoD (จาก roadmap)

- [ ] `docker compose up` แล้ว Lavalink container ลุกด้วย config ใหม่ + plugins โหลดสำเร็จ (เห็นใน log)
- [ ] `GET /api/v1/search?q=...` ตอบ TrackDTO จาก Lavalink (ytsearch/ytmsearch/spsearch)
- [ ] ผล search ถูก upsert ลง `tracks` (dedupe ด้วย source_name + source_identifier — search ซ้ำไม่เพิ่ม row)
- [ ] ปิด Lavalink → 503 UPSTREAM_UNAVAILABLE + error ชัดเจน (fail-soft)
- [ ] Contract tests ครบ 5 loadTypes + CI เขียว
- [ ] Smoke test จริง: `/v4/info` ผ่าน + `ytsearch:` คืนผล + `spsearch:` คืนผล (ถ้ามี credentials)

## Evidence / Verification

(เติมตอนปิด phase)

## Lessons learned

(เติมตอนปิด phase)

## Evidence / Verification (2026-09-20)

- Lavalink container จริง: v4.2.2 บน Java 18, plugins โหลดสำเร็จจาก maven.lavalink.dev (log ใน ticket 01)
- `GET /api/v1/search?q=one%20more%20time&limit=3` → 200 TrackDTO × 3 จาก YouTube จริง (ytsearch)
- Upsert/dedupe จริง: rows = distinct (source_name, source_identifier) — search ซ้ำไม่เพิ่ม row ซ้ำ
- Fail-soft จริง: stop lavalink → 503 `UPSTREAM_UNAVAILABLE` + degraded=["yt"] (~3 s)
- Circuit breaker recovery: start lavalink ใหม่ → half-open → 200
- Tests: server 24/24 (contract 5 loadTypes + client unit) — hermetic, ไม่ต้องมี docker
- lint / format:check / typecheck ทั้ง workspace เขียว
- ⚠️ **pending ผู้ใช้:** `spsearch:` ยังไม่ผ่านเพราะไม่มี SPOTIFY_CLIENT_ID/SECRET จริง (config พร้อม — ใส่ credentials ใน .env แล้ว `docker compose up -d lavalink`)

## Lessons learned

1. Lavalink 4.2.x ต่างจาก docs เดิมเยอะ: built-in youtube source deprecated (ต้อง `youtube: false` + plugin), มี source manager `nico`, และ plugin-config อยู่ที่ root `plugins:` — ยืนยันคุณค่าของขั้น "verify กับ example ของเวอร์ชันที่ pin" ตามที่ lavalink.md §2.2 บังคับ
2. ytsearch ของ YouTube ไม่ deterministic — search คำเดิมสองครั้งติดกันได้ผลไม่เหมือนกัน; การเช็ค dedupe ต้องดูที่ UNIQUE constraint ไม่ใช่ row count เทียบกับจำนวนผลค้นหา
3. LavaSrc ไม่ fail ตอน boot เมื่อ Spotify credentials ว่าง (token ไป fetch ตอน query) → เปิด `sources.spotify: true` ถาวรได้ โดย `spsearch` เพียง degraded จนกว่าจะมี credentials
4. `loadType=error` ต้อง map เป็น LavalinkError เฉพาะ (ไม่ใช่ plain Error) ไม่งั้น central error handler กลืนเป็น 500 แทน 503
