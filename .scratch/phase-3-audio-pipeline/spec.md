# Spec: Phase 3 — Audio Pipeline (+ minimal Auth)

> Roadmap: docs/roadmap.md §Phase 3 · References: docs/audio-pipeline.md, docs/security.md §8, ADR-003/006/007/008, docs/api.md §2/§6/§12

## Goal

เสียงจริงจาก YouTube เล่นใน browser ผ่าน proxy ของเรา — zero storage (ADR-008)

## ข้อตัดสินใจ (triage + user decisions 2026-09-20)

1. **ดึง minimal Auth มาทำก่อนใน Phase 3** (user decision) — เพราะ `/stream` ต้อง auth ด้วย session cookie (security.md §8.6) แต่ไม่มี phase ไหนรับผิดชอบ auth; scope ตาม api.md §2 + ADR-006: register/login/refresh(rotate)/logout/me, ตาราง `refresh_tokens`, argon2id, guard `requireAuth`
2. **Genre enrichment ทำใน Phase 3** (user decision) — Spotify Web API client credentials (ID/SECRET เดียวกับ LavaSrc), เติม `tracks.genres` ตอน upsert track ใหม่, **fail-soft** เมื่อยังไม่มี credentials/API ล่ม
3. **Transport:** resolver (yt-dlp, container แยก) → StreamService (same-origin proxy, in-memory) → `<audio>`; ห้าม fetch เพลงทั้งเพลงเข้า RAM (ADR-008)
4. **Stream URL cache:** ต่อ trackId TTL ~60 s ทั้งฝั่ง resolver และ StreamService
5. **Rate limit `/stream`:** 60 req/min/user + ≤ 2 concurrent/user (in-memory MVP — Phase 13 ย้าย Redis ถ้าจำเป็น)
6. **Prebuffer:** server รอ bytes แรก 2–5 s ก่อนตอบ (กันกระตุกช่วงต้น); stall > 30 s → abort
7. **SSRF guards (security.md §8):** host allowlist (googlevideo), DNS resolve + บล็อก private/loopback/link-local/ULA/metadata IP, ตรวจทุก redirect hop (≤ 3), content-type `audio/*` เท่านั้น, ไม่เคยเปิดเผย stream URL ให้ client
8. **Auth cookie ชุดเดียว:** refresh cookie (httpOnly + Secure + SameSite=Strict) ใช้ทั้ง /auth/refresh และ /stream — ไม่มี token ใน URL/log/referrer

## Out of scope (ตัดชัดเจน)

- Player state machine, queue, WS sync, EQ (Phase 4/5/7/8)
- SoundCloud resolver (post-MVP — ADR-008 Amendment)
- Local file ingest (Phase 14)
- Redis rate-limit/cache (Phase 13)
- Spotify playlist import, library search merge (Phase 6)
- การทำ UI ค้นหา/เล่นจริง (Phase 6/9) — การพิสูจน์ DoD ใช้ audio element ชั่วคราว + curl

## DoD (จาก roadmap)

- [ ] ค้นหาเพลงจาก YouTube → กดเล่น → ได้ยินเสียงผ่าน `/api/v1/stream/:id`
- [ ] seek ทำงาน (Range/206 ถูกต้อง)
- [ ] ปิด resolver แล้ว error ชัดเจน ไม่แฮงค์
- [ ] ผ่าน SSRF test suite ทั้งหมด
- [ ] genre ถูกเติมให้ track ใหม่อัตโนมัติ (เมื่อมี Spotify credentials)
- [ ] Auth ครบ: register/login/refresh/logout/me + rotation/reuse-detection tests
- [ ] CI เขียว (hermetic)

## Evidence / Verification

(เติมตอนปิด phase)

## Lessons learned

(เติมตอนปิด phase)

## Evidence / Verification (2026-09-20)

- **Auth:** register/login/refresh/logout/me ผ่าน API จริง; rotation + reuse-detection พิสูจน์ทั้ง test (10) และ smoke จริง; cookie httpOnly SameSite=Strict ใช้ยืนยัน /stream ตาม security.md §8.6
- **เสียงจริงผ่าน proxy:** `GET /api/v1/stream/:id` → 206 audio/webm 3.4 MB (WebM/Opus จาก YouTube — `file` ยืนยัน)
- **เล่นจริงใน browser:** `<audio>` บน localhost:8080 (same-origin ผ่าน nginx) → loadedmetadata 213 s → playing (currentTime วิ่ง) → seek ไป 60 s ได้ → pause ✓
- **Seek:** curl ยืนยัน 206 + `content-range: bytes 1000000-3433754/3433755`
- **Resolver down:** cache miss → 503 UPSTREAM_UNAVAILABLE ชัดเจน ~6 s; start กลับ → ทำงานทันที (circuit breaker + cache ทำงานตาม design)
- **SSRF suite:** 27/27 (allowlist, private/metadata/mapped IP, redirect, content-type)
- **Tests:** 68 ทั้ง workspace — hermetic, CI ไม่ต้องมี docker; lint/format/typecheck เขียว
- ⚠️ **pending ผู้ใช้:** Spotify Web API คืน 403 "Active premium subscription required for the owner of the app" → genre enrichment + `spsearch` จะทำงานเมื่อบัญชีเจ้าของ app มี Spotify Premium (โค้ดพร้อม, fail-soft ไม่กระทบส่วนอื่น)

## Lessons learned

1. **Fastify preHandler แบบ sync ต้องเรียก `done()`** — sync preHandler ที่ return undefined ปล่อยให้ request ค้าง (handler ไม่ถูกเรียก, ไม่มี error ให้เห็น) ใช้ async preHandler ตลอดจะปลอดภัยกว่า
2. **node:net BlockList เพี้ยนกับ IPv6 บน Node 26** (check คืน false แม้ใส่ subnet ถูก; IPv4 ผสม IPv6 ก็ผลคลุมเครือ เพราะ IPv4 ถูก normalize เป็น mapped-IPv6) — แยก BlockList ตาม version + เขียน IPv6 ด้วย BigInt
3. **Error ต้อง map ข้าม layer ให้ครบ** — ResolverError ที่โยนข้าม StreamService ไป route ทำให้ได้ 500 แทน 503; เจอตอน smoke จริง ไม่เจอจาก unit test เพราะ mock ใช้ StreamError
4. **Spotify บังคับ Premium ของเจ้าของ app ก่อนใช้ Web API** (policy ใหม่) — ควรตรวจสอบ requirement ของ third-party API ก่อนออกแบบ flow; fail-soft ของเราช่วยให้ไม่ตัน
5. **nginx `proxy_pass` มี/ไม่มี trailing slash ต่างกันขั้นวิกฤต** — มี slash ตัด prefix ทำ API path พัง; stream ต้อง `proxy_buffering off` ด้วย
