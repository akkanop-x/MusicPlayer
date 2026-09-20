# ADR-007: Phase B — เปิดใช้ YouTube/SoundCloud Source (ผู้ใช้ยอมรับความเสี่ยง)

- **สถานะ:** Accepted — **อัปเดต 2026-09-20:** ถูกยกระดับโดย [ADR-008](./008-youtube-first-no-local-storage.md) — YouTube/SoundCloud ไม่ใช่ "Phase 14" อีกต่อไป แต่เป็น **source หลักของ MVP** (Phase 2–3); Phase 14 เหลือไว้เป็น local file ingest (fallback)
- **วันที่:** 2026-09-20
- **เชื่อมโยง:** [ADR-003](./003-audio-pipeline.md), [ADR-008](./008-youtube-first-no-local-storage.md), [lavalink.md](../lavalink.md), roadmap Phase 3 / Phase 14

## Context

ADR-003 วาง YouTube/SoundCloud playback ไว้เป็น "Phase B" แบบมีเงื่อนไข เพราะมีความเสี่ยงที่ชัดเจน:

1. **ToS:** การดึง audio stream จาก YouTube/SoundCloud เพื่อเล่นในแอปของตนเอง (โดยเฉพาะผ่าน extractor เช่น yt-dlp) ขัดต่อข้อกำหนดของแพลตฟอร์มเหล่านี้ในหลายกรณี
2. **ความไม่เสถียร:** กลไก extraction เปลี่ยนบ่อย (YouTube แก้กัน extractor เป็นประจำ) → อาจพังและต้องอัปเดต dependency บ่อย
3. **IP ถูกบล็อก:** การ extract จำนวนมากจาก IP เดียวอาจถูก rate-limit/บล็อก

คำถามตอนจบ Phase 0 คือ "ยืนยันว่ายอมรับความเสี่ยงนี้ไหม หรือ MVP ใช้ self-hosted อย่างเดียว"

## Decision

**เจ้าของโปรเจกต์ยืนยันยอมรับความเสี่ยง (2026-09-20)** → YouTube/SoundCloud เข้าแผนอย่างเป็นทางการเป็น **Phase 14 (Phase B)** โดยมีเงื่อนไขการ implement ดังนี้:

1. **รูปแบบการทำงาน:** Lavalink + youtube-source plugin ใช้สำหรับ **search/metadata** เท่าเดิม (ADR-003); การหา **stream URL เพื่อ proxy เข้า browser** ใช้ **resolver service แยกตัว** (container ของตัวเอง, เช่น yt-dlp based) ที่ StreamService เรียกผ่าน HTTP ภายใน Docker network
2. **Feature flag:** `SOURCES_PHASE_B=off|on` — ปิดได้ทันทีเมื่อ extraction พัง/มีปัญหา โดยระบบที่เหลือ (local + http) ใช้งานได้ปกติ; track จาก source เหล่านี้ถูก mark `unplayable` ชั่วคราวเมื่อ flag ปิด
3. **Isolation:** resolver อยู่ใน container แยก (CPU/dependency/crash ไม่กระทบ API), cache stream URL อายุสั้น (URL ของ YouTube มี expiry)
4. **ข้อจำกัดที่ตกลงกัน:** ใช้สำหรับ self-hosting/การใช้งานส่วนบุคคล — ไม่ทำระบบเชิงพาณิชย์ที่ redistribute เนื้อหาเหล่านี้

## Alternatives

1. **ไม่เปิดเลย (self-hosted + direct HTTP เท่านั้น)** — ปลอดภัยสุด แต่ผู้ใช้ตัดสินใจแล้วว่าต้องการ catalog ของ YouTube/SoundCloud
2. **เปิดตั้งแต่ MVP (Phase 3–6)** — เพิ่มความเสี่ยง operational ตั้งแต่ก่อน core เสถียร; ยังเริ่มจาก source ง่ายก่อน (เส้นทางเดิม) แล้วเปิด Phase B เมื่อ pipeline ผ่าน DoD — ลดตัวแปรตอน debug

## Consequences

**บวก:**
- Catalog เพิ่มจากศูนย์เป็นระดับล้านเพลงโดยไม่ต้อง ingest เอง
- สถาปัตยกรรมไม่เปลี่ยน — resolver เป็นแค่ source ใหม่ของ StreamService (interface เดิม)

**ลบ / ที่ต้องยอมรับ:**
- เพลงจาก YouTube อาจพังเป็นช่วง ๆ โดยไม่มีความผิดของโค้ดเรา → ต้องมี UX รับมือ (TRACK_EXCEPTION + ข้ามอัตโนมัติ — มีอยู่แล้วใน player.md)
- ต้องอัปเดต resolver dependency บ่อย (เพิ่มงาน maintenance ชัดเจนใน roadmap Phase 14)
- เสี่ยงถูกบล็อก IP ของ server (บรรเทา: rotate/route planner, แต่ไม่การันตี)

## การประเมินใหม่ (trigger)

- ถ้าการ extraction พังนานเกิน (เช่น > 1 สัปดาห์ แก้ไม่ได้) หรือผู้ให้บริการดำเนินการทางกฎหมาย → ปิด flag ถาวรและประเมินกลับไปทางเลือก 1
