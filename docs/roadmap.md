# Development Roadmap

> แต่ละ Phase: Goal / Tasks / Dependencies / Definition of Done (DoD)
> กฎ: ห้ามขึ้น Phase ถัดไปถ้า DoD ก่อนหน้าไม่ผ่าน — ยกเว้นมี ADR ใหม่รับความเสี่ยงไว้ชัดเจน
> ผู้ review (คุณ) คือคนตัดสิน DoD แต่ละ phase

---

## Phase 0 — Architecture / Documentation ✅ (phase ปัจจุบัน)

**Goal:** เอกสารครบทุกมิติ ก่อนแตะโค้ด

**Tasks:** วิเคราะห์ requirements → พิสูจน์ความสามารถจริงของ Lavalink v4 → ออกแบบ architecture + audio pipeline → เขียน docs/ + ADR → roadmap

**Dependencies:** —

**DoD:**
- [x] `docs/` ครบตามโครงสร้างที่กำหนด + ADR ≥ 5 ฉบับ
- [x] ทุกไฟล์ระบุ Assumptions / Open Questions / Risks
- [x] **ผู้ใช้ review และอนุมัติ** ← อนุมัติเมื่อ 2026-09-20 ("เริ่มทำ Phase ที่ 1")

## Phase 1 — Project Setup

**Goal:** Skeleton monorepo + infra รันได้ด้วยคำสั่งเดียว

**Tasks:**
- pnpm workspace: `apps/web` (Vite React TS), `apps/server` (Fastify TS), `packages/shared`
- Tailwind + ESLint + Prettier + Vitest setup, `.env.example`, `.gitignore` (รวม `.env`)
- `docker-compose.yml`: postgres + lavalink + resolver (placeholder) + server + web
- Drizzle init + migration แรก (ตาม database.md)
- CI skeleton: lint + typecheck + unit test

**Dependencies:** Phase 0 อนุมัติ

**DoD:** `docker compose up` → ได้หน้า login placeholder + `/health` ตอบ 200 + migration run อัตโนมัติ + CI เขียว

## Phase 2 — Lavalink Integration

**Goal:** Backend คุยกับ Lavalink ได้จริง (ครั้งแรกของ "ความจริงเจอกับเอกสาร")

**Tasks:**
- ตั้ง Lavalink v4 จริงใน compose — **verify application.yml กับตัวอย่างของเวอร์ชันที่ pin** (ตาม lavalink.md §2.2)
- **ติดตั้ง youtube-source plugin** (สำคัญ — source หลักของ MVP ตาม ADR-008)
- **ติดตั้ง LavaSrc plugin + Spotify client credentials** (metadata/`spsearch` — grilling 2026-09-20)
- `LavalinkClient`: loadtracks + decodetrack + timeout + circuit breaker + health check
- Contract tests กับ mock Lavalink (fixture ทั้ง 5 loadType)
- Smoke test กับ Lavalink container จริง (`GET /v4/info` ผ่าน + `ytsearch:` และ `spsearch:` คืนผลได้)

**Dependencies:** Phase 1

**DoD:** `GET /api/v1/search?q=...` ตอบ TrackDTO จาก Lavalink (source: `ytsearch`/`ytmsearch`/`spsearch`) + upsert `tracks` ได้ + fail-soft เมื่อปิด Lavalink ได้ (503 + error ชัดเจน)

## Phase 3 — Audio Pipeline (รวม YouTube playback — ตาม ADR-008)

**Goal:** เสียงจริงจาก YouTube เล่นใน browser ผ่าน proxy ของเรา — zero storage

**Tasks:**
- **Resolver service แยก container** (yt-dlp based): trackId → stream URL + cache URL อายุสั้น (~60 s)
- `StreamService`: in-memory proxy + Range/206 + **prebuffer 2–5 s** + SSRF guards (allowlist googlevideo hosts; soundcloud เพิ่มเมื่อทำ post-MVP) + **stream auth ด้วย session cookie**
- **Genre enrichment จาก Spotify Web API** (artist genres → `tracks.genres`, cache) — YouTube ไม่มี genre tag (จำเป็นต่อ recommendation แนวเพลง)
- Integration test: Range correctness + SSRF suite + content-type allowlist + cookie auth (401 เมื่อไม่ล็อกอิน) + prebuffer behavior

**Dependencies:** Phase 2 (ต้องมี tracks จาก ytsearch ก่อน)

**DoD:** ค้นหาเพลงจาก YouTube → กดเล่น → ได้ยินเสียงผ่าน `/api/v1/stream/:id`; seek ทำงาน; ปิด resolver แล้ว error ชัดเจน ไม่แฮงค์; ผ่าน SSRF test suite ทั้งหมด; genre ถูกเติมให้ track ใหม่อัตโนมัติ

## Phase 4 — Player

**Goal:** State machine + คำสั่งพื้นฐานครบ

**Tasks:**
- `packages/shared/playerState` (pure) + unit tests ครบทุก transition
- Backend PlayerService + REST endpoints (api.md §4)
- Frontend AudioEngine + PlayerBar (UI หยาบ ๆ ได้)
- Edge cases ตาม player.md §5 (อย่างน้อย #1, #2, #3, #4, #8)

**Dependencies:** Phase 3

**DoD:** play/pause/resume/seek/skip(ข้อมูลจำลอง queue 1 เพลง)/volume ทำงาน + ไม่มีเสียงซ้อนเมื่อกด play ถี่ ๆ (test พิสูจน์)

## Phase 5 — Queue

**Goal:** Queue system เต็มรูปแบบตาม queue.md

**Tasks:**
- `packages/shared/queueLogic` + unit tests ครบ (รวมตัวอย่าง A→D→B→C)
- QueueService + persistence snapshot + REST endpoints
- Frontend QueuePanel

**Dependencies:** Phase 4

**DoD:** ทุก operation (add/addNext/remove/move/clear/shuffle/unshuffle/repeat) ทำงาน + previous ถูกต้องแม้ shuffle + restart backend แล้ว queue กลับมา

## Phase 6 — Search

**Goal:** Search เต็มรูปแบบ (YouTube/YTMusic + Spotify metadata + library ที่เคย resolve)

**Tasks:**
- ytsearch/ytmsearch/**spsearch** integration + debounce UI + pagination
- **Spotify playlist import** (วางลิงก์ playlist จาก Spotify → ได้ track ทั้งชุด, ผ่าน LavaSrc)
- Search ภายใน library ที่เคย resolve (pg_trgm บน title/artist) รวมเข้าผลลัพธ์
- Track page/detail + batch tracks endpoint

**Dependencies:** Phase 2 (Lavalink + youtube-source + LavaSrc), Phase 1 (DB)

**DoD:** ค้นหาเจอจาก YouTube/YTMusic/Spotify, ผลลัพธ์จาก Spotify เล่นได้จริง (fallback ไป YouTube), P95 < 2 s

## Phase 7 — WebSocket

**Goal:** Realtime sync จริง

**Tasks:**
- Socket.IO server + auth handshake + rooms
- ทุก event ตาม websocket.md + client reconnect + SYNC_REQUEST
- Multi-tab test

**Dependencies:** Phase 4–5 (มี state ให้ sync)

**DoD:** สอง tab — tab A สั่งเล่น tab B sync ทันที (< 500 ms); หลุด network 10 วินาทีแล้วเล่นต่อ + resync อัตโนมัติ

## Phase 8 — EQ

**Goal:** Equalizer ใช้งานได้จริง

**Tasks:**
- eqGraph + OfflineAudioContext tests + compressor safety
- Preset endpoints + seed system presets + EQ UI + persistence
- EQ_CHANGED sync ข้ามอุปกรณ์

**Dependencies:** Phase 4 (Web Audio ต้องอยู่ใน pipeline แล้ว)

**DoD:** เปลี่ยน band ระหว่างเล่น → ได้ยินเปลี่ยน ไม่มี click/pop; preset คงอยู่หลัง refresh; ผ่าน frequency response tests

## Phase 9 — Frontend เต็มรูปแบบ

**Goal:** UI/UX ใกล้ Spotify ตาม requirements

**Tasks:**
- ทุกหน้า: Home, Search, Library, Playlist, Settings + PlayerBar/NowPlaying สมบูรณ์
- **i18n ไทย/อังกฤษ** (react-i18next — locale ทุก string, สลับใน Settings)
- **Media Session API** (ปุ่มหูฟัง/lockscreen + artwork — grilling 2026-09-20)
- TanStack Query wiring ทุก feature, virtualized lists, responsive layout
- Loading/empty/error states ทุกจุด

**Dependencies:** Phase 4–8 (มีทุกอย่างให้ render)

**DoD:** ผ่าน E2E journeys 1–10 (testing.md §3.6) บน chromium

## Phase 10 — Playlist / Like / History

**Goal:** Library features ครบ

**Tasks:** PlaylistService + UI (CRUD, reorder), LikeService + UI, HistoryService + หน้า history, LIKES_CHANGED sync

**Dependencies:** Phase 6 (tracks), Phase 7 (sync)

**DoD:** สร้าง playlist → เพิ่มเพลง → เล่นทั้ง playlist ตามลำดับ; like แล้ว refresh ยังอยู่; history แสดงตามวัน + ถูกต้องตามเกณฑ์ 30 s

## Phase 11 — Autoplay

**Goal:** Queue ไม่หยุด

**Tasks:** Autoplay hook ใน advance() + prefetch recommendation ก่อนจบเพลง + UX (ปุ่ม toggle, ป้าย "Autoplay")

**Dependencies:** Phase 5, Phase 12 บางส่วน (ต้องมี provider แม้แต่ rule-based แบบง่ายสุด) — **หมายเหตุ: อาจสลับลำดับ 11/12 ทำ recommendation ก่อน**

**DoD:** เปิด autoplay เล่นจน queue หมด → เพลงต่อเนื่อง gap ≤ 3 s; ปิด autoplay → จบแล้วหยุด

## Phase 12 — Recommendation / Radio

**Goal:** Rule-based engine + radio

**Tasks:** RecommendationService (candidate/scoring/filter ตาม recommendation.md รวม **genre constraint §2.1.1** — ต่างศิลปิน/อัลบั้มได้ แนวเดียวกัน) + home feed UI + radio start/extend + unit tests scoring/filter ครบ

**Dependencies:** Phase 10 (มี likes/history data) + `tracks.genres` จาก Phase 3 ingest

**DoD:** Radio เล่นต่อเนื่อง ≥ 20 เพลงโดยทุกเพลงอยู่แนวเดียวกับ seed; ไม่แนะนำเพลงใน exclude set (test พิสูจน์); home feed แสดงและเล่นได้

## Phase 13 — Testing / Production

**Goal:** Hardening + deploy-ready

**Tasks:**
- CI เต็มรูปแบบ (unit + integration + E2E 3 browsers + nightly Lavalink จริง)
- Security review ผ่าน checklist security.md (โดยเฉพาะ SSRF suite, headers, rate limits)
- Performance: P95 play < 2 s, search < 2 s (วัดด้วย k6/Lighthouse), load test /stream
- Docker production images + docs สรุปการ deploy + runbook เล็ก (backup DB, rotation secrets)
- Optional: Redis (rate limit/cache) ถ้าวัดแล้วจำเป็น

**Dependencies:** ทุก phase

**DoD:** CI เขียวทั้ง pipeline; E2E ผ่านทั้ง 3 browsers; security checklist ผ่านทุกข้อ; deploy จริง 1 environment แล้วใช้งานได้ end-to-end

## Phase 14 — Local file ingest (optional fallback — เดิมคือ Phase B)

**Goal:** เพิ่มความทนทานให้ระบบ — มี source สำรองเมื่อ YouTube/SoundCloud extraction พัง ([ADR-008](./adr/008-youtube-first-no-local-storage.md) เหลือไว้เป็น fallback ไม่ใช่ primary)

**Tasks:**
- Media volume + ingest script (สแกนโฟลเดอร์, อ่าน ID3/Vorbis tags รวม genre)
- `StreamService` เพิ่ม source ชนิด `local` (serve จาก disk ผ่าน proxy เดิม)
- Feature flag `SOURCES_LOCAL` + หน้า admin (จัดการ import)

**Dependencies:** Phase 13

**DoD:** ไฟล์ที่ ingest เล่นได้จริงผ่าน player เดิม (seek/EQ/radio ใช้ได้) — และเมื่อปิด YouTube ชั่วคราว ระบบยังมีเพลงให้ฟังจาก local

---

## เส้นทางโดยรวม

```text
P0 docs ─► P1 setup ─► P2 lavalink(+yt-source) ─► P3 stream+resolver+YouTube ─► P4 player ─► P5 queue ─► P7 ws
                                                                        │
                                                                        ├─► P6 search ─► P10 library ─► P12 rec/radio ─► P11 autoplay*
                                                                        └─► P8 eq ─► P9 frontend เต็ม ──────────────────┘
                                                                                                                         │
                                               P13 testing/production ◄─────────────────────────────────────────────────┘
                                                       │
                                              P14 local file ingest (optional fallback — ADR-008)
```

> *Autoplay (P11) ต้องการ recommendation provider — ทำจริงตอน P12 แล้ว backtrack เติม P11 ได้ (ตามหมายเหตุใน phase)

## หมายเหตุการจัดลำดับ (เหตุผล)

- **Lavalink ก่อน stream:** ต้องพิสูจน์ contract ของ Lavalink ให้เจอ reality ตั้งเนิ่น ๆ (Phase 2 = จุด verify คำกล่าวอ้างของ docs ก่อนเขียนอะไรที่ต่อจากมัน)
- **WS หลัง player/queue:** ไม่มี state ก็ไม่มีอะไรให้ sync — ทำก่อนเปลืองแรง
- **Frontend เต็ม (P9) ทีหลัง backend feature:** ให้ UI ประกอบจาก API จริงที่ test แล้ว ลด double work
