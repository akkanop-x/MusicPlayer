# 009 — ถอด Spotify ออกทั้งสแตก เหลือ YouTube ล้วน

วันที่: 2026-09-20 · สถานะ: Accepted · ตัดสินใจโดยผู้ใช้

## บริบท

ADR-008 (Amendment ข้อ 2–4) เพิ่ม Spotify เป็นแหล่ง metadata ผ่าน LavaSrc (`spsearch:`)
และ genre enrichment ผ่าน Spotify Web API (client credentials) ตามแผน Phase 3

เมื่อนำไปใช้จริง (Phase 3) พบว่า:

1. **Spotify Web API บังคับ Premium ของเจ้าของ app** — token endpoint ผ่าน แต่
   `/v1/search` คืน `403 Active premium subscription required for the owner of the app`
   (นโยบาย Spotify 2024+) → genre enrichment + `spsearch` ใช้งานจริงไม่ได้
   โดยไม่มีทางเลือกอื่นฝั่งโค้ด
2. Metadata จาก YouTube ผ่าน Lavalink + yt-dlp ดีพอสำหรับ MVP — การ search และ
   playback ทำงานครบด้วย youtube-source plugin เพียง plugin เดียว

ผู้ใช้ตัดสินใจ 2026-09-20: **ถอด Spotify ออกให้หมด รวมถึงการ search — ใช้ YouTube
อย่างเดียว และเอา metadata ตามที่ YouTube ให้มาแบบดิบ**

## การตัดสินใจ

1. **Search = YouTube เท่านั้น** — `ytsearch:` (default) และ `ytmsearch:` (YouTube
   Music, ผ่าน youtube-source plugin เดียวกัน) ถอด source `sp` ออกจาก
   `SEARCH_SOURCES` (ขึ้น 400 VALIDATION_ERROR เมื่อยังส่งมา)
2. **ถอด LavaSrc plugin ออกจาก Lavalink** — `application.yml` เหลือ youtube-source
   plugin เดียว; ถอด `SPOTIFY_CLIENT_ID/SECRET` ออกจาก env schema / compose / .env
3. **Genre enrichment ใช้ metadata ของ YouTube เอง** — resolver (yt-dlp `-J`)
   อ่าน `categories` + `tags` → normalize (trim/lowercase, จำกัด 15 ค่า) → คืนมาพร้อม
   `/resolve`; StreamService persist เข้า `tracks.genres` แบบ fire-and-forget
   ตอน stream ถูกเปิด (fail-soft — genres ว่างไม่กระทบ playback)
   แทนที่ SpotifyWebApiService ซึ่งถูกลบ
4. **ข้อมูลดิบตาม YouTube** — ยังคงตาม database.md ข้อตัดสินใจ #4: เก็บ tag ดิบ
   lowercase/trim, ไม่ map กับ taxonomy ใด; recommendation (Phase หลัง) ใช้
   `tracks.genres` ชุดนี้

## ผลลัพธ์ / ข้อแลกเปลี่ยน

- ➕ ลด dependency ภายนอก 1 รายการ + ไม่ต้องมี Spotify account/Premium
- ➕ Lavalink เบาลง (โหลด 1 plugin), env/config ง่ายขึ้น
- ➖ metadata (ปกอัลบั้ม, ความยาว, การจัดหมวด) ใช้คุณภาพระดับ YouTube — ยอมรับได้
  สำหรับ MVP (ADR-008 youtube-first อยู่แล้ว)
- ➖ genres ถูกเติมเมื่อ track ถูกเล่นเท่านั้น (stream-time enrichment) ไม่ใช่ตอน search —
  ยอมรับได้เพราะ genre ไม่ใช่ critical path ของ search และทำให้ไม่ต้องยิง yt-dlp
  ต่อ 1 ผลลัพธ์ search (ช้า 1–3 s ต่อ track)

## Supersedes

- ADR-008 Amendment ข้อ 2 (Spotify เป็น metadata source), ข้อ 3 (Spotify Web API
  เป็น genre enrichment เท่านั้น), ข้อ 4 (คง LavaSrc)
