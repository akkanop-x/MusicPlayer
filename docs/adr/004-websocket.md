# ADR-004: Realtime Layer — Socket.IO (บน Node.js/Fastify)

- **สถานะ:** Proposed (รออนุมัติ Phase 0)
- **วันที่:** 2026-09-20

## Context

ระบบต้อง push state ไป browser แบบ realtime: player state, queue updates, EQ/volume sync ข้ามอุปกรณ์, likes และต้องรับ event จาก client (position sync, track ended, stalled) ความต้องการเฉพาะ: auth ต่อ connection, ส่งถึง "ทุก tab ของ user คนเดียว" (rooms), reconnect อัตโนมัติพร้อม resync, ack + timeout ต่อ event

## Decision

ใช้ **Socket.IO** (โปรโตคอล + client library) mount บน HTTP server เดียวกับ Fastify (path `/ws`) พร้อมโครงเรื่อง resync ผ่าน event `SYNC_REQUEST` (server ไม่ replay event ที่หลุด — client ขอ snapshot ล่าสุดแทน)

## Alternatives

1. **Raw WebSocket (ws library)** — เบากว่า (ไม่มี engine.io overhead) แต่ต้องเขียนเองทั้งหมดที่ Socket.IO ให้มา: reconnect แบบ exponential backoff, ack/timeout, rooms, fallback transport สำหรับ network แปลก ๆ งานเขียนนี้เป็น boilerplate ล้วนไม่สร้างมูลค่า — ยอมรับ overhead (เล็กมากเมื่อเทียบกับ audio data path ที่ไม่ผ่าน WS อยู่แล้ว)
2. **SSE (Server-Sent Events)** — ทำ server→client ได้ดีแต่ทำ client→server ไม่ได้ (ต้องจับคู่กับ REST ซ้ำ) + จำกัด connection ต่อ domain บน HTTP/1.1
3. **GraphQL Subscriptions** — ต้องพาทั้ง GraphQL stack เข้ามาเพื่อ realtime อย่างเดียว ไม่คุ้ม
4. **Polling** — ลื่นไม่พอสำหรับ player UX และเปลือง request

## Consequences

**บวก:**
- Reconnect/resync flow ครบใน library (เราออกแบบ `SYNC_REQUEST` บนสิ่งที่มี)
- Rooms (`user:{userId}`) ตอบโจทย์ multi-tab + ต่อยอด party mode ได้
- Ack + timeout ทำ "คำสั่งผ่าน WS, fallback REST" ได้สะอาด
- เอกสาร/ชุมชนใหญ่, มี Redis adapter สำหรับ multi-instance (phase 13)

**ลบ:**
- ผูกกับ client library ของ Socket.IO (ไม่ใช่ WS ธรรมดา) — ยอมรับได้เพราะเราคุมทั้งสองฝั่ง
- Engine.io framing overhead เล็กน้อย (ไม่มีผลเชิงประจักษ์เพราะ audio ไม่ผ่าน WS)
- Long-polling fallback ต้องปิดใน production config (มี WSS แล้วไม่จำเป็น)

## การประเมินใหม่ (trigger)

- ถ้าย้าย backend ไปภาษาอื่น/แยก service ที่ไม่มี Socket.IO → ย้ายไป raw WS + protocol เดิม (ชื่อ event ออกแบบไว้แล้วเป็น plain JSON)
- ถ้าต้องการ party mode หลายร้อยคน/ห้อง → ใช้ Redis adapter แทนการแก้ protocol
