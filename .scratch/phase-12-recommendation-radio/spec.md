# Phase 12 — Recommendation / Radio

**Goal ตาม roadmap:** Rule-based engine เต็ม + radio
**DoD:** Radio เล่นต่อเนื่อง ≥ 20 เพลงโดยทุกเพลงอยู่แนวเดียวกับ seed · ไม่แนะนำเพลงใน exclude set (test พิสูจน์) · home feed แสดงและเล่นได้
**Dependencies:** Phase 10 (likes/history) + Phase 11 (RecommendationProvider seam, autoplay refill/prefetch) — ✓ ทั้งคู่

## ข้อเท็จจริงจากการสำรวจ

- `RecommendationProvider` (Phase 11) มีแค่ `getRadioTracks` — ต้องเพิ่ม `getHomeFeed(userId, limit)` ตาม recommendation.md §1; PlayerService ใช้ผ่าน `deps.recommend` อยู่แล้ว ไม่ต้องแตะ
- `tracks.genres` เป็น `text[]` + GIN index (`tracks_genres_idx`) — resolver เติม genre (yt-dlp categories+tags, fire-and-forget) ตอน stream อยู่แล้ว (StreamService → updateGenres)
- radio endpoints ตาม api.md: `GET /recommendations?limit=20`, `POST /radio/start {seedTrackId}` → QueueStateDTO (queue ถูกแทน), `POST /radio/extend` → QueueStateDTO (เติม ≥ 5, ไม่มี radio → 409 NO_RADIO), และ `POST /queue/tracks` รับ `radioSeedTrackId` ได้
- บทเรียน Phase 11: artist จาก YouTube = ชื่อผู้อัปโหลด (same-artist matching แม่นต่ำ) → genre constraint (§2.1.1) แก้เชิงโครงสร้าง; provider ต้อง warn ตอน query พัง (เดิม `.catch(() => [])` กลืน error หาต้อง debug ยาก)

## การตัดสินใจออกแบบ

- **Provider v2 แทนที่ minimal impl เดิม** ในไฟล์เดียว (`ruleBased.ts`) — interface เดิม + `getHomeFeed`; PlayerService contract เดิมไม่พัง (seed เพิ่ม optional `boostArtists` สำหรับ adaptive artist ตาม §6 — backward compatible)
- **Candidate pool + scoring ตาม §2.1/§2.2:** same genre +6, liked +5, frequently played +4, same artist +4, same album +3, recently played +3; score = Σ base + 0.5×recencyBoost − 4 เมื่อ artist ซ้ำในผลลัพธ์เกิน 2 + jitter ±1; เลือกแบบ weighted random จาก top candidates (inject `rng` เพื่อ test)
- **Genre constraint เป็น hard filter ก่อน scoring** (§2.1.1): `candidate.genres ∩ seedGenres ≠ ∅`, normalize lowercase + ตัดขีด/ช่องว่าง; fallback เมื่อ seed ไม่มี genre → ใช้ genres จาก 10 เพลงเล่นจบล่าสุด; ไม่มี history เลย → คลาย constraint ใช้ same artist/album + warn log
- **Filtering ตาม §3:** exclude set จาก caller (current+queue+history ของ session), recently played 50 (home ผ่อนเป็น 20), skipped 20; ตัดจนไม่เหลือ → คลาย recently-played ก่อนแล้ว genre ท้ายสุด (§9)
- **Radio state อยู่ใน PlayerService:** `user.radio = { seedTrackId, genres } | null`; `startRadio` แทน queue ทั้งก้อน (current = seed, upcoming จาก provider 20); ขณะ radio active → refill/prefetch ทำงานเหมือน autoplay (seed = radio seed, คง genre constraint โดย provider) แม้ปิด toggle autoplay — ไม่งั้น DoD "เล่นต่อเนื่อง ≥ 20" ไม่ครบ; mutation ที่แทน queue (clear/play track/playPlaylist) ล้าง radio
- **Adaptive artist (§6):** เพลง radio เล่นจบ (ไม่ skip) → จด artist; ตอน refill/extend ส่ง `boostArtists` (+2/artist) ให้ provider
- **Home feed:** seedGenres = union genres จาก liked + top frequently played (≤ 5); ไม่มี like/history เลย → คืน [] + UI แสดง empty state "ไปค้นหา/like ก่อน" (§7); ไม่ cache (§8 #2)
- **Unit/contract test ครบ:** scoring, genre constraint, exclude set, fallback chain, radio endpoints, adaptive artist — hermetic (mock queries); E2E เพิ่ม J12 (home feed แสดง+เล่นได้)

## Tickets

- 01 Backend: provider v2 — candidate queries (genre/album/skipped/recent) + scoring + genre constraint + filters + getHomeFeed + unit tests
- 02 Backend: radio ใน PlayerService (startRadio/extendRadio/radio state/refill hook/adaptive artist) + contract tests
- 03 Backend: routes `GET /recommendations`, `POST /radio/start|extend`, queue.routes รับ radioSeedTrackId + app wiring + contract tests
- 04 Web: recommendationsApi + HomePage "แนะนำสำหรับคุณ" (play ได้ + radio button) + i18n + unit tests
- 05 E2E J12 + ปิด phase (gates, tracker Evidence/Lessons, commit/push, CI เขียว)

## Evidence (DoD)

1. **Radio เล่นต่อเนื่อง ≥ 20 เพลงแนวเดียวกับ seed** — ข้อมูลจริง (demo account, seed =
   "One More Time (Radio Edit)" genres [music, daft punk, one more time, …]): current + 20
   upcoming, dupes 0, **genre violation 0** (ตรวจ `tracks.genres` ทุก track ใน Postgres —
   normalized เทียบ seed genres) · genre constraint เป็น hard filter พิสูจน์ด้วย unit tests
   (candidate ต่างแนวถูกตัดแม้ same artist; relax เฉพาะผลว่าง — มีผลบางส่วนห้ามคลาย)
   + extension อัตโนมัติผ่าน refill/prefetch เดิม (radio เล่นต่อแม้ autoplay toggle ปิด —
   contract test "radio เล่นต่อเนื่องแม้ toggle autoplay ปิด")
2. **ไม่แนะนำเพลงใน exclude set** — unit tests (exclude ถูกส่งถึง query + output filter),
   contract tests (refill/extend exclude ครอบ current+upcoming+history), radio extend
   dedupe กับ queue — real data: dupes 0
3. **Home feed แสดงและเล่นได้** — E2E **J12 passed**: home-recs แสดง (จาก history จริง) →
   ▶ เล่นได้ → 📻 เริ่ม radio → badge 📻 โชว์ · E2E ทั้งชุด **12 passed** (32.7 s)

**Gates:** lint ✓ · format:check ✓ · typecheck ✓ (3 workspaces) · unit: shared 45 /
server 222 (+32) / web 72 (+3) · docker rebuild + asset hash ตรง container · CI run
(ดู commit ล่าสุดบน main) — เขียว

## Lessons

- **Seed ของ user เองห้ามโดน recent filter:** รอบแรกผมใส่ exclude (recently played 20)
  เข้าไปใน findLikedTracks/findTopPlayedTracks ด้วย → user ที่มี history สั้น ๆ (เพิ่งเล่น
  ทุกเพลงที่มี) ได้ home feed ว่างเป๊ะ (J12 fail #1) — แก้: filter ใช้กับ candidate
  (genre/artist/recent) เท่านั้น, seeds (liked/frequent) ไม่ถูกตัด
- **ห้ามคลาย genre constraint เมื่อมีผลบางส่วน:** เดิมคลายเมื่อ `picked < limit` →
  candidate ต่างแนวแอบเติมมาทำลาย DoD "แนวเดียวกันทั้งหมด" — แก้: คลายเฉพาะ
  `picked === 0` ตาม §9 ("pool ว่าง" ไม่ใช่ "pool สั้น")
- **REST ตอบเร็วกว่า WS:** badge radio พึ่ง WS PLAYER_STATE_CHANGED อย่างเดียวทำให้
  flash/หลุด (J12 fail #2) — client ที่รู้ผลลัพธ์ทันทีจาก REST (radio/start สำเร็จ)
  ควร set store เอง แล้วให้ WS confirm ตาม
- **jitter/weighted-pick ต้อง inject rng** ให้ test deterministic (rng=0 → ได้ตัวคะแนน
  สูงสุดเสมอ) — ทำให้ test scoring อ่านคะแนนแบบเปิดหนังสือได้
- Set `intersectionSize` ยังไม่มีจริงใน runtime ปัจจุบัน — เขียน helper เอง (genresIntersect)
  และ normalize genre ฝั่ง SQL ต้อง match ฝั่ง app เป๊ะ (regexp_replace เทียบ replace JS)
