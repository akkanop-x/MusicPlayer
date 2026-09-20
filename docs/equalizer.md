# Equalizer (EQ) System

> Web Audio API: BiquadFilterNode chain — ประมวลผล **ที่ browser ทั้งหมด** (backend เก็บแค่ค่า preset)
> ตำแหน่งใน pipeline: `MediaElementSource → EQ(×10) → GainNode(volume) → destination`

---

## 1. Web Audio Graph

```text
<audio> ──► MediaElementAudioSourceNode
              │
              ▼
        BiquadFilterNode #1  lowshelf    31.25 Hz
              ▼
        BiquadFilterNode #2  peaking      62.5 Hz
              ▼
        BiquadFilterNode #3  peaking      125 Hz
              ▼
        BiquadFilterNode #4  peaking      250 Hz
              ▼
        BiquadFilterNode #5  peaking      500 Hz
              ▼
        BiquadFilterNode #6  peaking      1 kHz
              ▼
        BiquadFilterNode #7  peaking      2 kHz
              ▼
        BiquadFilterNode #8  peaking      4 kHz
              ▼
        BiquadFilterNode #9  peaking      8 kHz
              ▼
        BiquadFilterNode #10 highshelf    16 kHz
              ▼
        GainNode (master volume 0–1)
              ▼
        AudioContext.destination
```

- สร้าง graph **ครั้งเดียว** ตอน AudioEngine boot (ผูกกับ audio element ถาวร) — เปลี่ยนแค่พารามิเตอร์ของ filter ไม่ rebuild
- ทำไมต้องผ่าน Web Audio เลย: `<audio>` เปลี่ยน `volume` ได้แต่ **ทำ EQ ไม่ได้** — ต้อง routing เข้า AudioContext

## 2. Bands (10 bands, ISO octave)

| Band | Freq     | Filter type | Q     |
| ---- | -------- | ----------- | ----- |
| 1    | 31.25 Hz | lowshelf    | 0.707 |
| 2    | 62.5 Hz  | peaking     | 1.0   |
| 3    | 125 Hz   | peaking     | 1.0   |
| 4    | 250 Hz   | peaking     | 1.0   |
| 5    | 500 Hz   | peaking     | 1.0   |
| 6    | 1 kHz    | peaking     | 1.0   |
| 7    | 2 kHz    | peaking     | 1.0   |
| 8    | 4 kHz    | peaking     | 1.0   |
| 9    | 8 kHz    | peaking     | 1.0   |
| 10   | 16 kHz   | highshelf   | 0.707 |

- Shelf ที่ปลายสองข้างเพราะความถือสุดขอบไม่มี "ศูนย์กลาง bandwidth" ที่มีความหมาย; peaking กลางเส้นด้วย Q=1.0 (bandwidth ≈ 1 octave — สมเหตุผลสำหรับ 10-band ISO)
- Gain: **−12 dB ถึง +12 dB** ต่อ band (step 0.5 dB ใน UI)
- ค่า freq/Q fix ตามตาราง — ผู้ใช้ปรับแค่ gain (MVP); "custom Q/freq per band" อยู่นอก scope

## 3. Real-time Changes

- ใช้ `BiquadFilterNode.gain.setTargetAtTime(value, ctx.currentTime, timeConstant=0.05)` — เฟดแบบ exponential กัน click/pop ระหว่างลาก slider (ห้าม set `.value` ตรง ๆ ตอนเสียงกำลังเล่น)
- ลาก slider ถี่ ๆ → throttle การส่งค่าไป backend (เช่นทุก 200 ms + ตอนปล่อย) แต่ **apply ที่ audio graph ทันทีทุก event** (ไม่ throttle ฝั่งเสียง)
- ผลลัพธ์: ได้ยินเปลี่ยนทันที (< 50 ms) ไม่มี noise artifact

## 4. Presets

| Preset     | Gain (dB) — bands 31.25→16k       |
| ---------- | --------------------------------- |
| Flat       | [0,0,0,0,0,0,0,0,0,0]             |
| Pop        | [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2] |
| Rock       | [4, 3, 1, 0, -1, 0, 1, 3, 4, 4]   |
| Classical  | [3, 2, 0, 0, 0, 0, 0, 2, 3, 4]    |
| Jazz       | [2, 3, 1, 2, -1, -1, 0, 1, 3, 3]  |
| Vocal      | [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] |
| Bass Boost | [8, 6, 4, 2, 0, 0, 0, 0, 0, 0]    |

- System presets: seed ลง `eq_presets` (`user_id IS NULL`) — แก้ไม่ได้, ลบไม่ได้
- Custom: user บันทึกชื่อ + bands[10] (validate: ความยาว 10, ค่า ∈ [−12, +12], freq/Q fix)
- Active preset เก็บใน `user_settings.active_eq_preset_id` (NULL = Flat)

## 5. State & Sync

```text
เปลี่ยน preset ในหน้า Settings
  → apply ที่ eqGraph ทันที (local, ไม่รอ network)
  → PUT /eq/active { presetId }
  → backend บันทึก + broadcast EQ_CHANGED ไป tab/อุปกรณ์อื่น
  → อุปกรณ์อื่น apply ตาม
```

- Edit custom preset ที่กำลัง active → PATCH preset → EQ_CHANGED ให้ทุกอุปกรณ์
- ค่า EQ ใช้ได้ทันทีที่โหลดแอป (ดึงจาก `GET /eq/presets` + settings ตอน boot) — เพลงแรกต้องมี EQ ถูกต้องตั้งแต่เสียงแรก

## 6. Persistence

- `eq_presets.bands` (JSONB) — โครงสร้าง `[{freq, gain, q}]` (แม้ freq/Q fix ก็เก็บครบ เพื่อ forward-compatible กับ future custom band)
- เปลี่ยนแปลง preset ทั้งหมดผ่าน REST (api.md §10) — ไม่มีการ push ค่า EQ ถี่ ๆ ผ่าน WS นอกจาก EQ_CHANGED ตอน active เปลี่ยน

## 7. Browser Compatibility / Limitations

- BiquadFilterNode: รองรับทุก browser ปัจจุบัน (Web Audio API Level 1)
- ⚠️ Safari/iOS: `AudioContext` sample rate/behavior ต่างเล็กน้อยแต่ chain นี้ standard หมด — ต้องมี E2E ครอบ Safari (testing.md)
- ข้อจำกัดเชิงสถาปัตยกรรม: EQ เกิดหลัง decode ที่ client → ผู้ใช้ปิด/แก้ client บายพาสได้ (ยอมรับ — EQ ไม่ใช่ฟีเจอร์ความปลอดภัย)
- clipping: หลาย band +12 dB อาจ clip → master GainNode ใส่ `DynamicsCompressorNode` เบา ๆ (threshold −6 dB) ก่อน destination เพื่อกัน distort — **ตัดสินใจ: ใส่ compressor เป็น default safety**

## 8. Assumptions

1. เพลงทุก source ผ่าน Web Audio graph เสมอ (ไม่มี path ที่เล่นตรง element หลุด graph) — มิฉะนั้น EQ หาย
2. จำนวน band 10 เป็นค่าที่เลือก (ระบบรองรับเปลี่ยนจำนวน band ได้เพราะ bands เป็น array ใน DB — แต่ MVP fix 10)

## 9. Open Questions

1. ต้องมี visualizer (analyser node spectrum) ในหน้า EQ ไหม? (เพิ่ม AnalyserNode ต่อท้าย chain ได้โดยไม่กระทบเสียง — nice-to-have)
2. Preamp slider (รวม gain ทั้งชุด) จำเป็นไหมนอกจาก compressor? (ค่าเริ่มต้น: ไม่ — compressor พอ)

## 10. Risks

| Risk                            | บรรเทา                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Click/pop ตอนเปลี่ยนค่า         | setTargetAtTime ทุก path (รวมตอน preset เปลี่ยน) + unit test กัน `.value=` ตรง |
| ลืม wire graph ใหม่หลัง rebuild | Graph สร้างครั้งเดียวต่อ session — ไม่มี rebuild path ใน MVP                   |
| EQ ไม่ถูกต้องบน browser เฉพาะ   | E2E cross-browser + snapshot response เทียบกันที่ test fixture                 |
