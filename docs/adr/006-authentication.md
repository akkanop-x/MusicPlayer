# ADR-006: Authentication — Refresh Token Rotation (httpOnly Cookie) + Short-lived Access Token

- **สถานะ:** Proposed (รออนุมัติ Phase 0)
- **วันที่:** 2026-09-20
- รายละเอียด implementation: [security.md](../security.md)

## Context

Web SPA + REST + WebSocket ทั้งหมดต้อง auth (ไม่มี anonymous usage ใน MVP) ข้อกังขาหลักของ SPA: เก็บ token ที่ไหน — localStorage โดน XSS ขโมย, ใช้ cookie ต้องกัน CSRF; ต้อง auth ได้ทั้ง REST และ WS handshake; ต้อง revocable session (logout / ตรวจจับ token ถูกขโมย)

## Decision

- **Access token: JWT อายุสั้น (15 นาที)** — ถือใน **memory ของ SPA เท่านั้น** (ไม่ลง storage ใด ๆ) ส่งใน `Authorization: Bearer`; ใช้กับ REST + WS handshake
- **Refresh token: opaque random token อายุ 30 วัน ใน httpOnly + Secure + SameSite=Strict cookie** — **rotate ทุกครั้งที่ใช้**; server เก็บ hash ของ token ปัจจุบันใน DB เป็น series
- **Reuse detection:** ถ้ามีการใช้ refresh token ที่ถูก rotate ไปแล้ว → ถือว่า series ถูกขโมย → revoke ทั้ง series + force login
- Password hashing: argon2id
- CSRF: อาศัย SameSite=Strict + ตรวจ Origin header ทุก mutating request (ไม่ใช้ double-submit token — มี cookie เดียวและมี origin check พอ)

## Alternatives

1. **JWT อายุยาวใน localStorage** — ง่ายสุด (ไม่มี refresh flow) แต่ XSS ใด ๆ = ขโมย session ได้เต็มอายุ token; ไม่ revocable โดยไม่ทำ blacklist ที่ทำให้ JWT เสียจุดขอบ (stateless)
2. **Session ID cookie ล้วน (server session ทั้งหมด)** — revocable ดี แต่ทุก request ต้องเช็ค DB (แก้ด้วย cache ได้แต่เพิ่ม moving part) และ WS handshake ผูก cookie อย่างเดียวทำให้เชื่อมจาก non-browser client ลำบากในอนาคต
3. **OAuth/Passkeys เป็น primary ตั้งแต่ MVP** — UX ดีแต่เพิ่ม dependency ภายนอก/flow ซับซ้อนกว่า scope MVP (email+password พอ); ออกแบบไว้เสริมทีหลังได้เพราะ auth service ถูกแยกเป็น service เดียวอยู่แล้ว

## Consequences

**บวก:**

- XSS ขโมยได้แค่ access token อายุ 15 นาที (ไม่ใช่ session ถาวร); refresh cookie JS อ่านไม่ได้
- Token theft มีทางตรวจจับ (reuse detection) + ตัดได้ (revoke series)
- ไม่ต้องพึ่ง CSRF token table
- WS auth ใช้ Bearer ตอน handshake ได้โดยไม่สับสนกับ cookie

**ลบ:**

- มี refresh flow ที่ต้องเขียน (frontend interceptor จับ 401 → refresh → retry ต้องระวัง race หลาย request พร้อมกัน — ใช้ single-flight refresh)
- Access token หายเมื่อ refresh หน้า (อยู่ใน memory) → ต้อง refresh หลังโหลด (one round-trip เพิ่ม แต่แลกกับความปลอดภัย — คุ้ม)
- Service worker/ช่องทาง non-browser ในอนาคตต้องหาทางส่ง refresh token ใหม่ (ยังไม่ใช่ use case)

## การประเมินใหม่ (trigger)

- เพิ่ม OAuth/Google login → เพิ่ม provider table + flow คู่ขนาน (โครง auth service รองรับอยู่)
- มี mobile app/native client → เพิ่ม grant แบบ token exchange (ไม่ใช้ cookie) โดยรักษา reuse detection
