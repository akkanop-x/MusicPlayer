# ADR-005: Frontend State — Zustand (client state) + TanStack Query (server state)

- **สถานะ:** Proposed (รออนุมัติ Phase 0)
- **วันที่:** 2026-09-20

## Context

Frontend มี state 3 พิวด้วยกัน:
1. **Server state** — search results, playlists, likes, history, settings (fetch/cache/invalidate)
2. **Player/Queue mirror** — สำเนา state ของ backend ที่ได้รับผ่าน WS/REST + ต้องอัปเดตถี่หน่อย (progress bar ทุก 250 ms)
3. **UI state** — panel เปิด/ปิด ฯลฯ

จุดกดดันหลัก: progress bar + position updates ต้องไม่ทำให้ re-render ทั้ง app, และ WS events ต้อง merge เข้า state ง่าย/ตรวจสอบได้

## Decision

- **Zustand** สำหรับ client state (player mirror, queue mirror, UI) — เลือก selector-based subscription เพื่อ progress updates ไม่กระเพื่อมทั้ง tree
- **TanStack Query** สำหรับ server state ทั้งหมด — ไม่เก็ง search/playlists/likes ใน Zustand เลย (แยกขอบเขตชัด: "ถ้าข้อมูลมี API endpoint เป็นเจ้าของ → TanStack Query")
- ไม่ใช้ Redux Toolkit, ไม่ใช้ Context สำหรับ state ระดับแอป

## Alternatives

1. **Redux Toolkit (RTK + RTK Query)** — ทรงพลัง, DevTools ดี แต่: boilerplate (slices/thunks) มากกว่า, และสำหรับ update ถี่ ๆ ต้องระวัง re-render เช่นกัน; RTK Query ก็ทำ server state ได้ แต่สรุปแล้วสองปัญหาของเรา (ถี่ + server cache) มีคำตอบที่เบากว่า
2. **Context + useReducer** — ได้มากับ React ไม่มี dependency แต่ทุก update ทำ re-render ทั้ง subtree ของ Provider (progress bar = พาทั้ง app วิ่งทุก 250 ms) — ต้องเขียน split-context เองจนเท่ากับเขียน state lib
3. **Jotai/Recoil (atomic)** — เหมาะมากกับ update ถี่ แต่ server cache ยังต้องจับคู่ TanStack Query อยู่ดี; Zustand + Query เป็น combo ที่คุ้นเคยกว่าในทีม/ชุมชนและตอบโจทย์ครบ

## Consequences

**บวก:**
- เขียนน้อย, ไฟล์ store เป็น plain TS (test ง่ายไม่ต้อง render)
- Selector subscriptions แก้ปัญหา re-render ของ progress ตรงจุด
- TanStack Query จัดการ cache/invalidate/retry ของทุก endpoint แบบมาตรฐานเดียว

**ลบ:**
- สองไลบรารี (แต่ขอบเขตการใช้แยกกันชัดเจนตามกฎใน decision — เขียนกฎนี้ไว้ใน frontend.md แล้ว)
- ไม่มี Redux DevTools time-travel (Zustand มี devtools middleware พอใช้)

## การประเมินใหม่ (trigger)

- ถ้า state logic ซับซ้อนขึ้นมาก (undo/redo ของ queue edits, ฯลฯ) → ประเมินย้ายส่วนนั้นไป XState/reducer เฉพาะส่วน ไม่ใช่เปลี่ยน state lib ทั้งระบบ
