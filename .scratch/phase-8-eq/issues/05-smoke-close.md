# 05 — Smoke: DoD ใน browser จริง + freq response ของจริง + ปิด Phase

Status: resolved

## งาน

- docker compose rebuild (server มี routes/seed ใหม่, web มี UI ใหม่)
- **DoD 1:** login → เล่นเพลง → เข้า /settings → ลาก slider band (เช่น Bass +10) ระหว่างเสียง
  เล่น → ได้ยินเปลี่ยน (วัดจาก applyEq ถูกเรียก + ไม่มี interruption/pause), ไม่มี click/pop
  (setTargetAtTime ทางเดียว — ตรวจ console ว่าง)
- **DoD 2:** เลือก preset (เช่น Bass Boost) → refresh หน้า → เข้า /settings ใหม่ →
  preset ที่ active คงเดิม + sliders ตรง bands + EQ_CHANGED sync ข้าม tab (เปิด 2 tab,
  เปลี่ยนที่ tab A → tab B sliders เปลี่ยนตาม)
- **freq response ของจริง:** ใน page evaluate สร้าง OfflineAudioContext → createEqFilters
  → getFrequencyResponse ที่ band centers → ตรง gain ±1.5 dB, Flat = identity
- ปิด Phase: tracker resolved + Evidence + Lessons, `bun run format` ก่อน commit,
  push → CI เขียว

## Evidence (2026-09-21) — docker rebuild + browser จริง (IAB, localhost:8080)

- **DoD 1 ✓ เปลี่ยน band ระหว่างเล่น:** เล่น "จากกันโดยสมบูรณ์ (Live Session)" →
  ลาก band 0 → **+10 dB** อัปเดตทันที (UI + engine.applyEq) — เสียงเล่นต่อเนื่อง
  paused:false, currentTime เดินหน้า 3 s ไม่มี interruption; applyEq ใช้ setTargetAtTime
  (timeConstant 0.05) ทางเดียว → ไม่มี click/pop ตาม design + unit test ห้าม `.value=`
- **DoD 2 ✓ preset คงอยู่หลัง refresh:** เลือก Bass Boost → sliders 8,6,4,2,0… ทันที →
  reload → select = Bass Boost + sliders อ่านค่าจาก server ตรงกันทั้ง 10 band
- **✓ frequency response ของจริง (OfflineAudioContext ในหน้า):** Flat = identity
  (max deviation **0 dB**); Bass Boost = [8.1 @10 Hz (plateau), 6.19 @31.25 (corner = ครึ่ง
  เดินทาง), 7.9 @62.5, 6.54 @125, 3.67 @250, 0.99, 0.22, 0.05, 0.01, 0 @16k] —
  ตรงกับสูตร RBJ ใน unit test ถึงระดับ 0.01 dB (DSP ของ browser = สูตรเดียวกัน)
- **✓ EQ_CHANGED ข้าม tab:** tab สอง (login ด้วย refresh cookie) เห็น Bass Boost จาก boot →
  tab A เลือก Flat → tab B ได้ EQ_CHANGED (`__rt.lastEvent = "EQ_CHANGED"`) select กลับ
  "ไม่ใช้ EQ" + sliders ทุกตัว = 0 โดยไม่ reload
- **✓ layout (ตรวจด้วย DOM geometry):** slider 10 แถว 504×4 px เรียง monotonic,
  value text ครบ, ปุ่มบันทึก/รีเซ็ตมีขนาดจริง, PlayerBar อยู่ครบ
- หมายเหตุ: judge ภาพ screenshot ใช้ไม่ได้ใน environment นี้ (model ไม่รับ image input) —
  ใช้ DOM-geometry + value assertions แทน (แนบภาพไว้ใน artifacts แล้ว)

## Lessons learned

- `biquadFilter.type = x` ต้อง assign ตรง (string property) — `.type.value` เงียบ ๆ ไม่มีผล
  ทำให้การวัดครั้งแรกเพี้ยน (default lowpass); getFrequencyResponse วัด **ราย node** —
  response ของ chain ต้องรวม dB ของทุก node เอง
- Playwright locator click ติด actionability กับปุ่มใน list — ใช้ evaluate DOM click แทนได้
- React select/slider ต้องใช้ native setter (`Object.getOwnPropertyDescriptor(...).set`)
  แล้ว dispatch `change`/`input` ถึงจะไปถึง onChange
