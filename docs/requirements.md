# Requirements

> Functional requirements ของ MusicPlayer Web Player
> ทุก feature ระบุ: Description / User Story / Expected Behavior / Edge Cases / Acceptance Criteria
> Non-functional requirements (performance, security) อยู่ท้ายไฟล์

---

## 1. Core Playback

### 1.1 Search

- **Description:** ผู้ใช้พิมพ์คำค้นแล้วรับผลลัพธ์เป็นรายการ track/artist/album ที่ match จาก source ที่เชื่อมต่ออยู่ (ผ่าน Lavalink) และจาก library ในระบบ
- **User Story:** ในฐานะผู้ฟัง ฉันอยากค้นหาเพลงด้วยชื่อเพลง/ศิลปิน เพื่อเลือกเพลงที่จะฟังได้ทันที
- **Expected Behavior:**
  - debounce การพิมพ์ ≥ 300 ms ก่อนยิง request
  - ผลลัพธ์แสดง: title, artist, duration, artwork (ถ้ามี), ปุ่ม "เล่นทันที" และ "เพิ่มใน queue"
  - แยกกลุ่มผลลัพธ์: Top result / Tracks / (Phase ถัดไป: Artists, Albums)
- **Edge Cases:** ไม่มีผลลัพธ์ (แสดง empty state), network timeout (แสดง retry), คำค้นว่าง (ไม่ยิง request), source ล่ม (แสดงว่า source ใดใช้ไม่ได้ ไม่ fail ทั้งหมด)
- **Acceptance Criteria:** พิมพ์ "hello" แล้วได้ผลลัพธ์ภายใน 2 วินาที (P95) บน source ปกติ; ผลลัพธ์ยังเล่นได้จริงเมื่อกด play

### 1.2 Play / Pause / Resume

- **Description:** เล่น track ที่เลือก (แทนที่ queue ปัจจุบัน), pause และ resume จากตำแหน่งเดิม
- **User Story:** ในฐานะผู้ฟัง ฉันอยากควบคุมการเล่นพื้นฐานได้จากทุกหน้าของแอป (player bar ติดด้านล่าง)
- **Expected Behavior:**
  - Play บน track ใหม่: หยุดเพลงเดิม → track ใหม่เริ่มเล่นภายใน 1–2 วินาที (source ที่รองรับ range/progressive)
  - Pause: เสียงหยุดทันที, position คงเดิม; Resume: เล่นต่อจาก position เดิม
  - Player bar แสดงปุ่มเดียวที่สลับ play/pause ตาม state
- **Edge Cases:** กด play ซ้ำระหว่างเพลงกำลังโหลด (ต้องไม่เกิดเสียงซ้อน — ดู player.md §Edge Cases), tab อยู่ background (เสียงต้องเล่นต่อได้), AudioContext suspended โดย autoplay policy (ต้อง resume หลัง user gesture)
- **Acceptance Criteria:** ไม่มีเสียงซ้อนเมื่อกด play ถี่ ๆ; pause→resume คลาดเพียง ≤ 200 ms จากตำแหน่งเดิม

### 1.3 Skip / Previous

- **Description:** ข้ามไปเพลงถัดไป / กลับเพลงก่อนหน้าตาม playback history (ไม่ใช่ index ของ queue แบบง่าย — ดู queue.md)
- **User Story:** ในฐานะผู้ฟัง ฉันอยากข้ามเพลงที่ไม่ชอบ และย้อนกลับฟังเพลงที่เพิ่งเล่นได้ แม้เปิด shuffle
- **Expected Behavior:**
  - Previous กลับไปเพลงล่าสุดใน playback history พร้อม position ที่เลิกฟัง (MVP: กลับไปเริ่มต้นเพลง หากเพลงปัจจุบันเล่นเกิน 3 วินาที — พฤติกรรมเดียวกับ Spotify)
  - Skip ไปเพลงถัดไปตามลำดับ queue (คำนึงถึง shuffle/repeat)
- **Edge Cases:** ไม่มีเพลงถัดไป → เข้าสู่ ENDED + autoplay (ถ้าเปิด) หรือหยุด; ไม่มี history → previous ไม่ทำอะไร (disabled)
- **Acceptance Criteria:** เปิด shuffle แล้วเล่น A→D→B→C เมื่ออยู่ C กด previous ต้องได้ B เสมอ

### 1.4 Seek

- **Description:** ลาก progress bar เพื่อกระโดดไปตำแหน่งใดก็ได้ของเพลง
- **Expected Behavior:** ลากแล้วปล่อยจึง seek (ไม่ seek ระหว่างลาก); เสียงเล่นต่อจากตำแหน่งใหม่ภายใย 1 วินาที; backend ได้รับ position ใหม่ด้วย
- **Edge Cases:** seek ไปเกินความยาวเพลง (clamp ที่ duration), seek บน live stream (ปุ่ม seek ถูก disable — `isStream=true`), seek ระหว่าง LOADING (คิวคำสั่งไว้หรือ ignore)
- **Acceptance Criteria:** seek แล้ว position ที่ backend เก็บ + UI แสดง + เสียงจริงตรงกัน (±200 ms)

### 1.5 Queue

- **Description:** แสดงรายการเพลงที่จะเล่นต่อ พร้อมเพลงกำลังเล่น, เพิ่ม/ลบ/จัดลำดับ — รายละเอียดเต็มอยู่ใน queue.md
- **Acceptance Criteria:** เพิ่มเพลงขณะเล่นเพลงอื่น ต้องไม่กระทบเพลงที่กำลังเล่น; ลบเพลงที่กำลังเล่น = skip ไปเพลงถัดไป

---

## 2. Playback Controls

### 2.1 Shuffle

- **Description:** สุ่มลำดับเพลงที่ "ยังไม่เล่น" โดยไม่กระทบเพลงที่กำลังเล่น
- **Expected Behavior:** เปิด/ปิดได้ตลอดเวลา; เมื่อปิด shuffle กลับมาเป็นลำดับเดิมของ queue (unshuffle — ต้องจำ original order)
- **Edge Cases:** shuffle เมื่อเหลือ 1 เพลง, shuffle ซ้ำระหว่างเพลงกำลังเปลี่ยน, unshuffle หลังมีการ remove/move
- **Acceptance Criteria:** เปิด shuffle แล้ว previous ยังทำงานถูกต้องตาม history

### 2.2 Repeat

- **Description:** โหมด repeat 3 แบบ: OFF / ONE (เพลงเดิมวน) / ALL (ทั้ง queue วนกลับไปเพลงแรก)
- **Edge Cases:** repeat ONE + skip ต้องไปเพลงถัดไป (ไม่วนเพลงเดิม); repeat ALL + queue ว่าง; เปลี่ยนโหมดกลางเพลง
- **Acceptance Criteria:** repeat ALL เล่นครบ queue แล้ววนกลับเพลงแรกได้ไม่มีที่สิ้นสุด

### 2.3 Autoplay

- **Description:** เมื่อ queue จบและไม่ได้ repeat ระบบเติมเพลงใหม่จาก recommendation engine โดยอัตโนมัติ
- **Edge Cases:** recommendation ไม่มีผลลัพธ์ (queue จบแล้วหยุด), ผู้ใช้ปิด autoplay, โหลด recommendation ไม่ทันตอนเพลงจบ (ดู player.md §gapless)
- **Acceptance Criteria:** เปิด autoplay แล้วเพลงไม่หยุดเกิน 3 วินาทีระหว่าง queue จบกับเพลง recommended เพลงแรก

### 2.4 Volume

- **Description:** ปรับระดับเสียง 0–100% จาก player bar + ระบบจำค่าไว้ต่อ user
- **Expected Behavior:** เปลี่ยนแบบ real-time ไม่กระทบ position; mute toggle แยกจาก volume
- **Edge Cases:** volume=0 + กดขึ้นนิดเดียว (fine control), hardware media keys (bonus — ดู open questions)
- **Acceptance Criteria:** ค่า volume คงอยู่หลัง refresh และข้ามอุปกรณ์ (sync ผ่าน backend)

---

## 3. Library

### 3.1 Like / Favorite

- **Description:** กดหัวใจเพื่อ like/unlike track, มีหน้า "Liked Songs"
- **Expected Behavior:** สถานะ like sync ทันทีทุก tab ที่ล็อกอินเดียวกัน (ผ่าน WebSocket)
- **Edge Cases:** unlike ระหว่างหน้า liked กำลังโหลด (optimistic update + rollback ถ้า fail), like track ที่ยังไม่มีในระบบ (upsert track ก่อน)
- **Acceptance Criteria:** like เก็บใน DB พร้อม timestamp; รายการ liked เรียงจากใหม่ไปเก่า

### 3.2 Playlist

- **Description:** สร้าง/แก้ชื่อ/ลบ playlist, เพิ่ม/ลบ/จัดลำดับ/ย้ายเพลง, เล่น playlist ทั้งหมด
- **Expected Behavior:** เจ้าของ playlist มีเท่านั้นที่แก้ได้ (MVP ไม่มี collaborate/share)
- **Edge Cases:** ลบ playlist ที่กำลังเล่นอยู่ (เพลงปัจจุบันเล่นต่อได้จนจบ แต่ queue ต้องไม่พัง), เพิ่มเพลงซ้ำ (allow, แต่ต้องมี UI บอก duplicate), reorder ระหว่างเล่น
- **Acceptance Criteria:** เพิ่ม playlist ลง queue แล้วลำดับเพลงตรงตาม playlist

### 3.3 Listening History

- **Description:** บันทึกทุกเพลงที่เล่นจริง (เล่นเกินเกณฑ์ เช่น ≥ 30 วินาที หรือจบเพลง — สำหรับ recommendation), แสดงเป็น timeline ย้อนหลัง
- **Expected Behavior:** บันทึก track, playedAt, durationPlayed; แสดงหน้า history แบ่งตามวัน
- **Edge Cases:** เล่นซ้ำเพลงเดิมในวันเดียว (บันทึกแยกกัน), skip ก่อน 30 วิ (บันทึกเป็น "skipped" สำหรับ recommendation filter แต่ไม่นับเป็น history แสดงผล — หรือนับ ตามมติใน Open Questions)
- **Acceptance Criteria:** history ไม่โตเร็วเกินจน query ช้า (มี index + pagination)

---

## 4. Discovery

### 4.1 Recommendation

- **Description:** แสดง "แนะนำสำหรับคุณ" บน home: อิงจาก liked/history/frequently played ด้วย rule-based engine (ดู recommendation.md)
- **Expected Behavior (ตัดสินใจจากผู้ใช้ 2026-09-20):** แนะนำ **ต่างศิลปิน/ต่างอัลบั้มได้ แต่ต้องอยู่ในแนวเพลง (genre) เดียวกันกับ seed** — genre มาจาก tag ของไฟล์ (ID3/Vorbis) ที่ ingest เข้าระบบ
- **Acceptance Criteria:** ไม่แนะนำเพลงที่เพิ่งเล่น / อยู่ใน queue / เพลงปัจจุบัน / เพลงที่ถูก skip; เพลง recommended ทุกเพลงมี genre ตรงกับ seed (ยกเว้นกรณี fallback ตาม recommendation.md §2.1.1)

### 4.2 Radio

- **Description:** สร้าง "สถานี" จาก seed (track/artist/playlist) — ระบบเติมเพลงเข้า queue แบบไม่มีที่สิ้นสุดโดยใช้ recommendation engine + autoplay
- **Expected Behavior:** กด "เริ่ม Radio" จาก track → queue เต็มด้วยเพลง **แนวเพลงเดียวกันกับ seed** (ต่างศิลปิน/อัลบั้มได้), เมื่อเหลือ < 2 เพลง เติมเพิ่มอัตโนมัติ
- **Edge Cases:** seed track ไม่มีข้อมูลพอ (fallback เป็น popular tracks), ผู้ใช้ลบเพลงใน radio ออก (ต้องไม่เติมกลับมาเป็นเพลงเดิมทันที)
- **Acceptance Criteria:** radio เล่นต่อเนื่องได้ ≥ 20 เพลงโดยไม่ต้องกดอะไรเพิ่ม

---

## 5. Audio

### 5.1 Equalizer

- **Description:** 10-band EQ (31.25 Hz – 16 kHz), gain −12 ถึง +12 dB, แสดงผลกระทบแบบ real-time — รายละเอียดใน equalizer.md
- **Edge Cases:** เปลี่ยน EQ ระหว่างเล่น (ต้องไม่มี click/pop — ใช้ setTargetAtTime), หน้าจอเล็ก (แนวนอน/แนวตั้ง)
- **Acceptance Criteria:** ปรับ band ใด ๆ แล้วได้ยิน/เห็นสเปกตรัมเปลี่ยนทันที (latency ต่ำกว่าที่มนุษย์รู้สึก ~50 ms สำหรับ visual)

### 5.2 EQ Presets

- **Description:** Preset สำเร็จรูป (Flat, Pop, Rock, Classical, Jazz, Vocal, Bass Boost) + บันทึก custom preset ต่อ user
- **Acceptance Criteria:** เลือก preset แล้วค่าทุก band ถูก apply พร้อมกัน; custom preset ตั้งชื่อซ้ำไม่ได้ (ต่อ user)

---

## 6. Non-Functional Requirements

| หมวด          | ข้อกำหนด                                                                 |
|---------------|--------------------------------------------------------------------------|
| Performance   | Start playback < 2 s (P95); search < 2 s (P95); UI interaction < 100 ms  |
| Compatibility | Chrome/Edge/Firefox/Safari สองเวอร์ชันล่าสุด; desktop + mobile browser   |
| Auth          | ต้องล็อกอินก่อนใช้ (MVP); ไม่มี anonymous playback                        |
| Security      | ดู security.md — โดยเฉพาะ SSRF ใน stream proxy                            |
| Reliability   | WS disconnect ต้อง reconnect อัตโนมัติและ resync state ได้                |
| Data          | Listening history ต้องไม่หายเมื่อ refresh หรือ reconnect                    |

---

## Assumptions

1. ผู้ใช้ต้องสมัคร/ล็อกอิน (email+password) ใน MVP — ไม่มี OAuth ใน phase แรก
2. ~~YouTube/SoundCloud extraction เป็น phase ถัดไป~~ **ตัดสินใจแล้ว (2026-09-20):** YouTube/YT Music เป็น **source หลักของ MVP** และ**ไม่มีการเก็บไฟล์เพลงลง server เลย** (zero storage, stream ผ่าน RAM เป็น proxy) — ดู [ADR-008](./adr/008-youtube-first-no-local-storage.md); local file ingest เหลือไว้เป็น optional fallback (Phase 14)
3. **ผู้ใช้เป้าหมาย: ส่วนตัว/กลุ่มเล็ก 1–5 คน** (grilling 2026-09-20) — ทุก decision เชิง scale (partition, replica, CDN, anti-abuse) ตัดสินจากข้อนี้
4. ผู้ฟัง 1 คน = 1 active player (multi-device sync ของจริงอยู่นอก MVP แต่ architecture ต้องไม่ปิดทาง)
5. **Spotify = แหล่ง metadata/catalog เท่านั้น** (ค้นหา, playlist import, genre enrichment ผ่าน LavaSrc + Spotify Web API) — เสียงจริงมาจาก YouTube เสมอ (grilling 2026-09-20); SoundCloud เลื่อนออกจาก MVP

## Decisions (จากผู้ใช้ — grilling session 2026-09-20)

1. ~~เพลงที่ skip ก่อน 30 วิ โผล่ใน History ไหม?~~ → **โผล่** พร้อม tag `skipped` (แยกสี/ไอคอนใน UI)
2. ~~ภาษา UI~~ → **รองรับสองภาษา: ไทย + อังกฤษ** (i18n, ค่าเริ่มต้นตาม browser locale, สลับได้ใน Settings — เก็บใน `user_settings.locale`)
3. Recommendation/Radio ยึด **genre เดียวกัน** เป็น constraint หลัก (ต่างศิลปิน/อัลบั้มได้) — รายละเอียดใน recommendation.md §2.1.1
4. Stream authentication ใช้ **cookie-based** (httpOnly + SameSite=Strict) — ปลอดภัยและเร็วที่สุด (security.md §8)
5. **Media Session API ใส่ MVP (Phase 9)** — ปุ่ม play/pause/next จากหูฟัง/lockscreen + ปกเพลงบน lockscreen (cost ต่ำ, core UX ของ music player)
6. **ไม่ทำ PWA/Offline ใน MVP** — ระบบ stream จาก YouTube เสมอ ไม่มีไฟล์ให้ cache (สอดคล้อง ADR-008)
7. **Previous เริ่มที่ 0 เสมอ** — ไม่จำตำแหน่งที่เลิกฟัง (ตรง behavior ของ Spotify)
8. **ลบหลายรายการด้วย DELETE + body** — คง REST style เดิม (ระบบส่วนตัวผ่าน reverse proxy ของเรา ไม่มี corporate proxy)

## Open Questions

- **ไม่มีค้าง** — Open Questions ทั้งหมดถูก resolve ใน grilling session 2026-09-20 (รายละเอียดกระจายอยู่ในแต่ละไฟล์ด้วยเครื่องหมาย ~~ตัดสินใจแล้ว~~)

## Risks

- ดู risks รวมใน [audio-pipeline.md](./audio-pipeline.md) และ [security.md](./security.md)
