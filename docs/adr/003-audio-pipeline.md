# ADR-003: Audio Pipeline — Lavalink เป็น Resolver, Browser เป็น Renderer (Hybrid)

- **สถานะ:** Accepted — **Amended 2026-09-20 โดย [ADR-008](./008-youtube-first-no-local-storage.md):** MVP sources ไม่ใช่ self-hosted files อีกต่อไป — YouTube เป็น source หลักแบบ zero storage (แก้ไขเฉพาะ "source ที่ใช้" ไม่แก้ pipeline architecture)
- **วันที่:** 2026-09-20
- รายละเอียดเชิงเทคนิคเต็ม: [audio-pipeline.md](../audio-pipeline.md), [lavalink.md](../lavalink.md)

## Context

Requirement ตั้งต้นสมมติ pipeline: `Source → Lavalink → Audio Stream → Browser → Web Audio (EQ/Vol)` ต้องพิสูจน์ก่อนว่า Lavalink ส่ง audio ถึง browser ได้จริงหรือไม่

**ข้อค้นพบจากเอกสารทางการ (lavalink.dev, Lavalink v4):**

1. Lavalink เป็น "standalone audio sending node" **สำหรับ Discord** — มันเล่นเสียงด้วยการส่ง Opus ทาง UDP ไปยัง **Discord voice server** เท่านั้น (ผ่านระบบ session/player ที่ผูกกับ Discord guild + voice credentials)
2. **ไม่มี endpoint ใด** ใน REST/WebSocket API ของ v4 ที่ส่ง audio ออกให้ client ทั่วไป (HTTP stream/ICY/WebSocket audio ไม่มีอยู่จริง)
3. `GET /v4/loadtracks` คืน metadata เท่านั้น — ฟิลด์ `uri` คือ **หน้าเพลง** (เช่น `youtube.com/watch?v=...`) ไม่ใช่ stream URL; stream จริงถูก resolve ภายใน Lavaplayer ตอนเล่นและไม่ถูก expose
4. YouTube source ถูกย้ายออกจาก core ไปเป็น plugin ทางการ (`lavalink-devs/youtube-source`) — มีผลต่อแผน source ที่ต้องระบุให้ชัด

**สรุป:** `Lavalink → Browser` โดยตรง **ทำไม่ได้** — ไม่ใช่เรื่อง config หรือ plugin แต่เป็นการออกแบบของตัว software

## Decision

ใช้สถาปัตยกรรม **Hybrid "resolve vs render"**:

```text
Search/Resolution (control):  Browser → Backend → Lavalink /v4/loadtracks (metadata only)
Playback (data):             Browser <audio> ← Backend StreamProxy ← Media Source
Rendering:                    Browser Web Audio (EQ ×10 → Gain → speakers)
```

- **Lavalink v4** ถูกใช้เฉพาะการค้นหา/resolve track metadata (มันเก่งเรื่องนี้: source หลายแหล่ง, plugin ecosystem เช่น LavaSrc/youtube-source)
- **Backend เป็น stream proxy** (same-origin, HTTP Range, SSRF-guarded) — จำเป็นเพราะ CORS ของ source ภายนอก + ความปลอดภัย (ไม่เปิด URL ให้ client เลือก)
- **Browser เป็น audio renderer** ผ่าน `<audio>` + MediaElementSource + BiquadFilter EQ — ได้ EQ real-time ฟรี, ไม่ต้อง transcode ฝั่ง server
- Source แบ่ง 2 ระดับ: **MVP** = self-hosted files + direct HTTP audio URLs; **Phase B** = YouTube/SoundCloud extraction (ผ่าน resolver แยกตัว, flag เปิด/ปิดได้) เพราะความเสี่ยง ToS/การเปลี่ยน mechanism บ่อย

## Alternatives

| ทางเลือก | ทำไมไม่เลือก (ตอนนี้) |
|-----------|--------------------------|
| **A. Lavalink ส่งเสียงถึง browser โดยตรง** | ไม่มีอยู่จริง (พิสูจน์แล้วข้างบน) — เป็น requirement ที่เป็นไปไม่ได้กับ Lavalink v4 |
| **C. Server-side transcode (FFmpeg → HLS/ICY → MSE)** | ใช้ได้จริงแต่: CPU หนักต่อ concurrent stream, latency HLS สูง (2–6 s), เพิ่ม service JVM+FFmpeg อีกชั้น สำหรับ MVP ที่ต้องการ EQ ที่ client ทำได้อยู่แล้ว ถือว่า over-engineer — **เก็บเป็นแผนถัดไป** เมื่อต้องการ: server-side EQ จริง, sync หลายอุปกรณ์ระดับ ms, หรือ transcode codec ที่ browser ไม่รองรับ |
| **D. ทิ้ง Lavalink ใช้ extractor เอง (yt-dlp) ทำทุกอย่าง** | เรียบง่ายกว่า operationally แต่ requirement ของเจ้าของโปรเจกต์ระบุให้ใช้ Lavalink; และ ecosystem ของ Lavalink (source plugins, LavaSrc) คุ้มค่าในบทบาท resolver |
| **E. เล่นตรงจาก source โดยไม่ proxy** | เจอ CORS-tainted silence กับ MediaElementSource + ต้องเปิดเผย/ยอมรับ URL จากภายนอก → ไม่ปลอดภัย |

## Consequences

**บวก:**
- ใช้ Lavalink ได้ตาม requirement โดยไม่ฝืนความเป็นจริงของมัน
- EQ/Volume ทำที่ client = zero CPU ฝั่ง server, real-time, แยกต่อ user อัตโนมัติ
- Latency ต่ำ (progressive HTTP + Range, ไม่มี segment delay แบบ HLS)
- เปิดทางย้ายไปทางเลือก C ในอนาคตได้ (client รู้จักแค่ `/api/v1/stream/:id` — เบื้องหลังเปลี่ยนได้)

**ลบ / ยอมรับ:**
- Backend เป็น SPOF ของเสียง (ล่ม = เสียงหยุด) และกิน bandwidth ทั้งหมด
- ไม่ gapless, seek ต้องพึ่ง Range support ของ source
- Backend-authoritative position ต้องเชื่อ playback events จาก client (มี sanity check กันปลอม)
- YouTube/SoundCloud จริงช้าออกไป Phase B (มี resolver แยก + ความเสี่ยง ToS ที่ต้องยอมรับ)

## การประเมินใหม่ (trigger)

- ต้องการ sync หลายอุปกรณ์แบบแม่นระดับ < 200 ms หรือ party mode → ไปทางเลือก C (server-side rendering)
- YouTube extraction พังถี่เกินไปทนไม่ได้ → ประเมินใหม่ระหว่าง yt-dlp resolver (Phase B) กับตัด source ออก
- Concurrent streams กิน egress เกินงบ → CDN/object storage สำหรับไฟล์ self-hosted + แยก stream worker process
