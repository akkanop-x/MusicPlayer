# Phase 11 — Autoplay

**Goal (roadmap):** Queue ไม่หยุด
**Tasks:** Autoplay hook ใน advance() + prefetch recommendation ก่อนจบเพลง + UX (ปุ่ม toggle, ป้าย "Autoplay")
**Dependencies:** Phase 5 (queue) ✓, Phase 7 (WS) ✓, Phase 10 (likes/history = วัตถุดิบ recommendation) ✓
**DoD:**

1. เปิด autoplay เล่นจน queue หมด → เพลงต่อเนื่อง gap ≤ 3 s (E2E J9)
2. ปิด autoplay → จบแล้วหยุด (QUEUE_ENDED เหมือนเดิม)

## แหล่งอ้างอิง

- roadmap.md Phase 11 · queue.md §5 (advance 4b: autoplay → recommendation), §7 (prefetch: upcoming < 2 + เหลือ < 30 s → extend 10, exclude = recent + current + upcoming), §10 (autoplay ไม่แนะนำ excludeSet)
- recommendation.md §1 (interface `getRadioTracks(seed, exclude, limit)`), §3 (filter), §7 (fallback เมื่อ user ใหม่) — **scoring/genre constraint/home feed/radio เป็น Phase 12**, Phase 11 ทำแค่ provider ง่ายสุดตาม roadmap ("ต้องมี provider แม้แต่ rule-based แบบง่ายสุด")
- player.md #11 (track ended แต่ autoplay โหลดไม่ทัน — server refill แบบ sync ใน reportTrackEnded ก่อน emit TRACK_STARTED → gap = 1 round trip)
- websocket.md §3 (TRACK_STARTED/QUEUE_UPDATED เดิม reuse, PLAYER_STATE_CHANGED แนบ autoplay)
- api.md #39 `PATCH /settings { autoplay? }` — route มีอยู่แล้ว (eq.routes), ต้อง propagate ไป PlayerService

## การออกแบบ (ตัดสินใจหลัก)

### Backend

- **Provider seam:** `RecommendationProvider { getRadioTracks(seed: { trackId? }, exclude: Set<TrackId>, limit): Promise<TrackDTO[]> }` อยู่ที่ `apps/server/src/services/recommendation/provider.ts` — PlayerService รับผ่าน `PlayerDeps.recommend` (DI เดิม) → unit test ใช้ fake, app.ts ผูก `realRecommendationProvider(db)`. Phase 12 จะแทน impl เต็ม (scoring/genre) โดย interface ไม่เปลี่ยน
- **Minimal impl (Phase 11):** candidates = same artist ของ seed (string equality, case-insensitive — recommendation.md §4 ยอมรับ) → ตกแต่งด้วย top frequently played + liked ของ user เมื่อ same artist ไม่พอ → กรอง exclude + กรอง track ที่ไม่มีในตาราง (query จาก tracks เท่านั้นจึงเล่นได้เสมอ); **genre constraint ยังไม่ทำ** (Phase 12)
- **Refill hook (queue.md §5 4b):** ใน PlayerService — `skip()` / `reportTrackEnded()` / `reportStalled()`: จับ seed = trackId ของ current ก่อน `queueAdvance`; ถ้า advance คืน null (upcoming ว่าง + repeat off) และ `settings.autoplay` → `recommend(..., limit 10)` → ตัวแรกเป็น current, ที่เหลือเข้า upcoming → โค้ด emit เดิม (optimisticPlay + emitTrackStarted) ทำงานต่อ; provider ว่าง/autoplay ปิด → พฤติกรรมเดิม (NO_NEXT / QUEUE_ENDED)
- **exclude set:** current + upcoming + history (session) ทั้งหมด — ผู้ให้บริการเพิ่ม recent DB history เอง (Phase 12 จะทำ skipped/recent filter เต็ม)
- **Prefetch (queue.md §7):** ใน `syncPosition` หลัง accepted — เงื่อนไข `autoplay && upcoming.length < 2 && durationMs - positionMs < 30_000 && !prefetching` → fire-and-forget extend 10 เข้า upcoming (flag `prefetching` กันซ้ำ, เช็ค cap/append ตอน resolve กัน race กับ advance, version+1 + persist + QUEUE_UPDATED)
- **setAutoplay(userId, enabled):** อัปเดต in-memory settings + emit PLAYER_STATE_CHANGED (persist เป็นหน้าที่ PATCH /settings เดิม — เรียกผ่าน dep เดียวกัน); `PlayerStateChangedPayload` เพิ่ม `autoplay?: boolean` (shared, backward compatible) — SYNC_REQUEST/ emissions ทุกจุดใช้ helper `stateChangedPayload(user)` ส่ง autoplay ครบ → cross-tab sync
- **Wiring:** `EqRoutesDeps.onAutoplayChanged?` — PATCH /settings สำเร็จเมื่อ body มี `autoplay` → เรียก dep → app.ts ผูก `player.setAutoplay` (แก้บั๊กเดิม: settings patch แล้ว player ใน memory ไม่รู้เรื่อง)

### Web

- **ปุ่ม toggle:** PlayerBar (ขวา ข้าง repeat) — `⚡ Autoplay`, `data-testid="btn-autoplay"`, `aria-pressed` ตาม store.autoplay, ป้ายข้อความ "Autoplay" ตาม roadmap
- **engine.setAutoplay:** `settingsApi.patch({ autoplay })` → setStateDto ตาม response; sync ข้าม tab ผ่าน PLAYER_STATE_CHANGED (handlers → applyRemotePlayerState patch autoplay)
- **i18n:** `player:autoplay*` th/en
- ไม่แตะ flow ended เดิม (report TRACK_ENDED → server advance+refill → TRACK_STARTED โหลดเอง)

## Out of scope (Phase 12)

- scoring/candidate pool เต็ม (co-played, recency boost, jitter), genre constraint §2.1.1, home feed, radio start/extend endpoint
- E2E วัด gap ≤ 3 s แบบ precise (assert เชิง behavior: จบแล้วเล่นต่อด้วย track ใหม่)
- UI skeleton "กำลังเลือกเพลงถัดไป" (refill sync ใน round trip เดียว — ไม่จำเป็น MVP)

## Tickets

- 01 Backend: RecommendationProvider seam + minimal provider (repo queries) + unit tests
- 02 Backend: PlayerService refill (ended/skip/stalled) + setAutoplay + PLAYER_STATE_CHANGED.autoplay + tests
- 03 Backend: prefetch ใน syncPosition + PATCH /settings wiring + contract tests
- 04 Web: toggle UX + engine hook + cross-tab sync + i18n + tests
- 05 E2E: เปิด J9 + รัน suite + docker verify + tracker resolved + commit/CI

## Evidence (ปิด Phase 2026-09-20)

- **DoD 1 — เปิด autoplay คิวหมด → ต่อเนื่อง gap ≤ 3 s:** E2E J9 (journeys.spec.ts) ผ่าน — เล่นเพลงเดียว (upcoming ว่าง) → seek ท้ายเพลง → ended → server refill จาก provider → TRACK_STARTED เพลงใหม่ → `expectAudible` ผ่าน; debug instrumentation วัด gap จริง ≈ 1–2 s (ended ที่ i:2 → เสียงใหม่เล่นที่ i:3, sample 1 s) + ปุ่ม toggle (btn-autoplay aria-pressed) สลับได้บนหน้าจริง
- **DoD 2 — ปิด autoplay → จบแล้วหยุด:** unit test "autoplay ปิด (setAutoplay) → skip คิวหมดโยน NO_NEXT, ไม่เรียก recommend" + "recommend คืน empty → จบคิวเหมือน autoplay ปิด" (player.contract.test.ts)
- **Unit:** web 69 / server 190 ผ่าน (เพิ่ม: provider 5, autoplay refill/prefetch 6, wiring 1) · lint/format/typecheck เขียว · E2E เต็ม 11 passed (J1–J11, ไม่มี skip รอยัง)
- **Docker:** rebuild server+web, bundle ใหม่ขึ้นจริง, ตรวจบน browser จริงด้วย debug spec (hook audio element) ก่อนรัน suite

## Lessons

- **Artist จาก YouTube metadata = ชื่อผู้อัปโหลด** ("Naf' Manson" สำหรับเพลง Daft Punk reupload) — same-artist string matching พังกับข้อมูลจริง; ต้องมี fallback "เพลงชื่อคล้ายกัน" (token ≥ 4 ตัวอักษร) เพื่อเจอเวอร์ชันอื่นของเพลงเดียวกัน → Phase 12 genre constraint จะช่วยโครงสร้างนี้แบบถาวร
- **top-played fallback ตีกับ exclude (session history):** เพลงที่ user เล่นบ่อยคือเพลงที่เพิ่งเล่นไปแล้ว → โดน exclude หมด → ต้องมี candidate แหล่งที่ไม่ผูกกับ session
- **`.catch(() => [])` ใน refill กลืน error ของ provider** — debug ต้องไล่จาก DB snapshot (queue_items kind='upc'/'hist') + request log + ทดสอบ repo กับ Postgres จริงแยกจาก unit test; lesson: provider ควร log warn ตอน throw (ทำใน Phase 12 ตอน refactor)
- E2E assert แบบ `.not.toBe(oldTitle)` ผ่านแม้ QUEUE_ENDED (cur ว่าง) — assert เชิง behavior ต้องกันค่าว่างเสมอ
