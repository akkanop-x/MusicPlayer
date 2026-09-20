# ADR-008: YouTube-first MVP — Zero Media Storage + Progressive Buffering

- **สถานะ:** Accepted (ตัดสินใจโดยเจ้าของโปรเจกต์, 2026-09-20) — **ส่วนที่เกี่ยวกับ Spotify (Amendment ข้อ 2–4) ถูกยกเลิกโดย [ADR-009](./009-drop-spotify-youtube-only.md)**
- **วันที่:** 2026-09-20
- **เชื่อมโยง:** [ADR-003](./003-audio-pipeline.md) (audio pipeline หลัก), [ADR-007](./007-phase-b-youtube-source.md) (การยอมรับความเสี่ยง YouTube), [audio-pipeline.md](../audio-pipeline.md), [roadmap.md](../roadmap.md)

## Context

เมื่อถามถึงวิธีนำเพลงเข้าระบบ (ingest) เจ้าของโปรเจกต์ตอบชัดเจน: **ไม่ต้องการโหลด/เก็บไฟล์เพลงเข้า server เลย — ใช้ YouTube เป็น catalog หลักและ stream โดยตรง**

ข้อจำกัดทางเทคนิคที่พิสูจน์ไปแล้ว (ADR-003):

1. Lavalink ส่งเสียงถึง browser ไม่ได้ (มันส่ง Opus ทาง UDP ไป Discord voice server เท่านั้น)
2. Browser ดึง audio จาก YouTube ตรง ๆ ไม่ได้ (CORS บล็อก MediaElementSource, stream URL มีอายุสั้น + ผูกกับ IP ผู้ขอ)

ดังนั้น "ไม่เก็บไฟล์" ทำได้จริง แต่ "เสียงไม่ผ่าน server" ทำไม่ได้ — เสียงต้อง**ไหลผ่าน RAM ของ backend** เป็น proxy ตลอดเวลา

นอกจากนี้เจ้าของโปรเจกต์เสนอแนวคิด "ดึงข้อมูลเสียงมาทั้งหมดแล้วค่อย ๆ ส่งเป็น buffer ให้ browser" ซึ่งได้รับการวิเคราะห์เป็นส่วนหนึ่งของ ADR นี้ (ดู Alternatives)

## Decision

1. **YouTube/YT Music เป็น source หลักของ MVP** — ย้ายจาก Phase 14 ขึ้นมาเป็นหัวใจของ Phase 2–3; SoundCloud ตามมาใกล้กัน
2. **Zero media storage** — backend **ไม่มี disk สำหรับเพลงเลย**; stream bytes ผ่าน RAM (in-memory proxy) จาก YouTube → backend → browser แบบ real-time แล้วหายไป
3. **Buffering strategy: browser-driven + server prebuffer เล็ก**
   - Browser (`<audio>` + HTTP Range) เป็นผู้เติม buffer ล่วงหน้าเอง ~30–60 s อัตโนมัติ
   - Server **prebuffer 2–5 s แรก** จาก YouTube ก่อนเริ่มส่งกลับ (กัน source ช้า/กระตุกช่วงต้น)
   - **ห้าม fetch เพลงทั้งเพลงเข้า RAM** — เพิ่ม latency เริ่มเล่น, RAM โตตาม concurrent users (~1 MB/นาที/คน), และจังหวะดึงเร็วผิดปกติเสี่ยงถูก YouTube rate-limit
   - MSE (MediaSource Extensions) / whole-track RAM cache → เก็บเป็น optimization ภายหลัง เมื่อวัดแล้วเจอปัญหาจริง (gapless / adaptive bitrate)
4. **Stream URL resolution:** ใช้ resolver service แยก container (yt-dlp based) — Lavalink ใช้เฉพาะ search/metadata (ytsearch/ytmsearch) เหมือนเดิม
5. **Local file ingest → optional (Phase 14)** เป็น fallback เมื่อ extraction พัง — ไม่อยู่ใน critical path ของ MVP
6. **Genre enrichment:** เพลงจาก YouTube ไม่มี genre tag → ต้องมี metadata provider (เช่น Last.fm API) มาเติม `tracks.genres` — เป็น dependency ใหม่ที่จำเป็น เพราะ genre constraint ของ recommendation (ADR ต่อเนื่องจาก requirements decision 2026-09-20)

## Alternatives

| ทางเลือก                                                                                     | ผลการพิจารณา                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ดึงเพลงทั้งเพลงเข้า server ก่อน แล้วค่อย trickle เป็น buffer** (ข้อเสนอของเจ้าของโปรเจกต์) | ปฏิเสธเป็น default — เวลาเริ่มเล่นช้า (ขัดเป้า < 2 s), RAM ~1 MB/นาที/listener, จังหวะดึงเร็วผิดปกติเสี่ยงโดน YouTube rate-limit; **แนวคิด "buffer คอยเลี้ยง" ได้ครบผ่าน browser buffer + server prebuffer แทน** — และเก็บไว้เป็นทางเลือกย่อย (per-track RAM cache) เมื่อมีหลักฐานว่า source ช้าจนจำเป็น |
| Browser ดึงจาก YouTube ตรง (ไม่ผ่าน server)                                                  | ไม่มีอยู่จริง — CORS + URL อายุสั้น + ผูก IP                                                                                                                                                                                                                                                             |
| เก็บไฟล์ลง server (ingest แบบเดิม)                                                           | ถูกปฏิเสธโดยเจ้าของโปรเจกต์ — ยังคงมีได้เป็น optional fallback (Phase 14)                                                                                                                                                                                                                                |
| MSE + server ป้อน segment เอง                                                                | ซับซ้อนเกินความจำเป็นของ MVP; `<audio>` + Range ให้ buffer ครบแล้ว — defer                                                                                                                                                                                                                               |

## Consequences

**บวก:**

- ไม่ต้องมี storage/media volume/ingest script — deployment ง่ายขึ้น, catalog มีขนาดระดับล้านเพลงตั้งแต่วันแรก
- ไม่มีความรับผิดชอบเรื่อง copyright ของไฟล์ที่เก็บ (ไม่มีไฟล์ให้เก็บ)
- RAM ใช้คงที่ต่อ listener (~prebuffer เท่านั้น)

**ลบ / ที่ต้องยอมรับ (สำคัญ — อ่านให้ครบก่อน implement):**

1. **Bandwidth 100% ผ่าน server** — ทุกวินาทีที่ฟัง = ดาวน์โหลดจาก YouTube + ส่งออกให้ client พร้อมกัน (egress ×2); ค่าโฮสติ้งโตตรงตาม usage
2. **Single-source dependency:** ถ้า YouTube extraction พัง → **ทั้งแอปไม่มีเพลงเล่นเลย** — บรรเทา: resolver เป็น container แยกอัปเดตง่าย, มีหน้า source status, local ingest เป็น fallback ในอนาคต (Phase 14)
3. **Rate-limit/IP block เสี่ยงสูงขึ้น** เพราะทุก playback คือ traffic จริงจาก IP server — บรรเทา: rate limit ต่อ user (api.md §12), จำกัด concurrent streams ≤ 2/user
4. **Genre enrichment เป็น dependency ใหม่** — ต้องผูก Spotify Web API ตั้งแต่ Phase 2–3 ไม่งั้น recommendation แนวเพลงใช้ไม่ได้กับเพลงจาก YouTube (provider ตัดสินใจใน Amendment ข้อ 3)
5. ค้นหาต้องพึ่ง `ytsearch`/`ytmsearch` ของ Lavalink + youtube-source plugin — การที่ YouTube เปลี่ยนกลไกกระทบ search ด้วย ไม่ใช่แค่ playback

## Amendment (grilling session, 2026-09-20)

หลัง grilling session กับเจ้าของโปรเจกต์ มีการปรับเพิ่มเติมจาก decision หลักข้างบน:

1. **ผู้ใช้เป้าหมาย = ส่วนตัว 1–5 คน** — bandwidth risk ลดจาก "สูง" เหลือ "ต่ำ–กลาง"; rate-limit risk จาก YouTube ลดตาม (แต่ไม่เป็นศูนย์)
2. **เพิ่ม Spotify เป็นแหล่ง metadata** (ผ่าน LavaSrc `spsearch` + Spotify Web API) — Spotify ไม่มีเสียง; การเล่นจริง fallback ไป YouTube เสมอ; SoundCloud **เลื่อนออกจาก MVP**
3. **Genre enrichment = Spotify Web API เท่านั้น** (artist genres) — ไม่ใช้ Last.fm; เก็บ raw tags + เปิดทาง mapping layer ภายหลัง
4. **ยืนยันไม่ย้าย search ไปให้ resolver** — Lavalink + LavaSrc ครอบทั้ง YouTube/YTMusic/Spotify ในชุด contract เดียว

## การประเมินใหม่ (trigger)

- YouTube extraction พังนาน > 1 สัปดาห์ หรือถูกดำเนินการทางกฎหมาย → ปิด source + เร่ง Phase 14 (local ingest) เป็น primary
- ค่า bandwidth สูงเกินงบ → พิจารณา per-track RAM cache (คืนทางเลือกที่ปฏิเสธไว้ — เหมาะเมื่อมีเพลงยอดฮิตถูกเล่นซ้ำ), CDN, หรือย้ายไป self-hosted
