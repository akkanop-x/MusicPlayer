# Security Design

> หลักการ: **ไม่มี secret ใดถึงมือ browser**, ทุก input ถือว่าไม่น่าเชื่อถือ, backend เป็น gate เดียวของทั้ง Lavalink และ media sources
> ดูเพิ่ม: [ADR-006](./adr/006-authentication.md)

---

## 1. Authentication & Authorization

### 1.1 กลไกที่เลือก (สรุป — เต็มใน ADR-006)

- **Refresh token rotation** ใน `httpOnly` + `Secure` + `SameSite=Strict` cookie — ต้าน XSS ขโมย token ได้ดีกว่าเก็บ JWT ใน localStorage
- **Access token (JWT, อายุ 15 นาที)** ส่งใน `Authorization: Bearer` — ถูกถือใน memory ของ SPA เท่านั้น (ไม่ลง storage)
- เก็บ **hash ของ refresh token** ใน DB (`refresh_tokens` table) — ตรวจจับ reuse: ถ้ามีคนใช้ token ที่ถูก rotate ไปแล้ว → revoke ทั้ง series (ตรวจแจ้งเตือนการโจรกรรม session)
- Password hashing: **argon2id** (memory cost ตามค่า default ที่แนะนำปัจจุบัน)

### 1.2 Authorization

- ทุก resource ผูก `user_id` — ownership เช็คที่ service layer (playlist/like/settings/queue เป็น per-user เสมอ)
- ไม่มี role/admin ใน MVP; system EQ presets readable by all authenticated

### 1.3 Session

- Refresh token อายุ 30 วัน (rotate ทุกครั้งที่ refresh)
- Logout = revoke refresh series + clear cookie
- ทุก WS connection ผูกกับ user จาก JWT ตอน handshake

## 2. CORS & CSRF

| ประเด็น | การตัดสินใจ                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| CORS    | Allowlist origin เดียว (`CORS_ORIGIN` env — หน้า frontend); ไม่ใช้ `*` เด็ดขาด; อนุญาตเฉพาะ methods/headers ที่ใช้จริง |
| CSRF    | Cookie (refresh) ใช้ `SameSite=Strict` + ตรวจ `Origin` header ทุก mutating request — ไม่ต้องพึ่ง CSRF token            |
| WS      | ตรวจ `Origin` ระหว่าง handshake — ปฏิเสธถ้าไม่ตรง allowlist                                                            |

## 3. Rate Limiting & Abuse

> ค่าทั้งหมดออกแบบสำหรับ **ระบบส่วนตัว 1–5 คน** (grilling 2026-09-20) — มีไว้กัน bot/loop ไม่ใช่กัน load จริง; ปรับตัวเลขตอนขยาย

- ตารางขีดจำกัดอยู่ใน api.md §12 (auth 5/min/IP, search 30/min/user, player commands 60/min/user, stream 60 req/min + ≤ 2 concurrent ต่อ user)
- ใช้ตัวนับแบบ fixed/sliding window ใน memory (MVP) — ย้าย Redis เมื่อ multi-instance
- Account lockout ชั่วคราวหลัง login fail ต่อเนื่อง (เช่น 10 ครั้ง/15 นาที → lock 15 นาที) + generic error (ไม่บอกว่า email มีจริงหรือไม่)

## 4. Input Validation

- ทุก route มี schema validation (zod) ก่อนเข้า service: types, ความยาว, enum, ขอบเขตตัวเลข (เช่น volume 0–100, positionMs ≥ 0, bands ∈ [−12,12])
- ไม่เชื่อ client payload เรื่อง identity — user id มาจาก JWT เท่านั้น
- File/path input (ไม่มีใน MVP จาก client แต่กันไว้): track `file_path` มาจาก DB เท่านั้น ไม่รับจาก request

## 5. SQL Injection

- ใช้ Drizzle ORM (parameterized queries) ทั้งหมด — ห้าม string concatenation สร้าง SQL
- ถ้าจำเป็นต้อง raw query (เช่น trigram search) — ใช้ template parameter ของ Drizzle เท่านั้น + code review ทุกจุด

## 6. XSS

- React มี default escaping — ห้ามใช้ `dangerouslySetInnerHTML` (เพิ่ม lint rule บล็อก)
- track metadata (title, author จาก Lavalink/source ภายนอก) คือ **untrusted input** — render เป็น text เสมอ, ไม่สร้าง HTML จากมัน, ไม่ใช้มันใน `href`/`src` โดยตรง (URL ต้องผ่าน sanitizer ที่ allow เฉพาะ http/https)
- CSP header แบบเข้ม: `default-src 'self'`, `img-src 'self' https:`, `media-src 'self'` (สำคัญ: เสียงมาจาก origin เราเท่านั้น), ไม่มี inline script

## 7. WebSocket Security

- Handshake auth ด้วย JWT (`auth.token`) — ไม่มี anonymous connection
- `Origin` check ตอน handshake
- ทุก client→server event มี payload validation + rate limit (เช่น POSITION_SYNC > 1 ครั้ง/วินาที → ปฏิเสธ)
- Sanity checks ตาม websocket.md §4 (position เดินหน้าไม่เร็วกว่า real-time × 1.2 ฯลฯ) — ป้องกันการปั้น history/recommendation data ปลอม

## 8. Stream Proxy & SSRF (จุดเสี่ยงสุดของระบบ)

เพราะ StreamService ต้อง fetch URL ภายนอกตาม track metadata → เป็นช่อง SSRF ถ้าเลยเผลอ

กติกาบังคับ (implement ใน Phase 3 + test ใน Phase 13):

1. **ไม่รับ URL จาก client เด็ดขาด** — stream target มาจาก `tracks` table เท่านั้น ซึ่งบันทึกได้จาก resolver ที่ควบคุมโดยเราเท่านั้น (YouTube/SoundCloud ผ่าน resolver — ADR-008; local ingest เป็น Phase 14 fallback)
2. **Allowlist ของ hosts** ที่ proxy ยอม fetch (config + per-source) — อย่างอื่น reject
3. **DNS resolution + IP check ก่อน connect:** แม้ host จะผ่าน allowlist ต้อง resolve แล้วตรวจว่า IP ไม่ใช่ loopback (127.0.0.0/8), private (10/8, 172.16/12, 192.168/16), link-local (169.254/16, fe80::/10), unique-local (fc00::/7) หรือ metadata service (169.254.169.254) — กัน DNS rebinding ด้วยการ connect ด้วย IP ที่ resolve แล้ว (+ ตรวจอีกครั้งทุก redirect hop)
4. **Redirect policy:** ตามได้สูงสุด 3 hop, ทุก hop ผ่าน check 2–3 ซ้ำ
5. **Response จำกัด:** ต้องเป็น `audio/*` (ตาม allowlist content-type), มี `Content-Length` หรือ chunked ที่ถูกจำกัดด้วย stream timeout (เช่น stall > 30 s → abort)
6. **Auth ก่อน stream (ตัดสินใจแล้ว 2026-09-20 — เดิมเป็น Open Question #1):** `/stream/:trackId` ต้องผ่าน authentication โดยใช้ **session cookie (httpOnly + Secure + SameSite=Strict) แบบเดียวกับ refresh/auth flow** — เลือกทางนี้เพราะ **ปลอดภัยที่สุด** (ไม่มี token ค้างใน URL, log, referrer อย่าง query `?token=`) และ **เร็วที่สุด** (browser แนบ cookie ให้เองแบบ same-origin, ไม่ต้อง mint/exchange token ต่อ request) เงื่อนไข: SPA ต้องถูกเสิร์ฟ same-origin กับ API (reverse proxy เดียวกัน) ซึ่งเป็น deployment มาตรฐานที่วางไว้แล้ว; ทุก request ยังผ่าน rate limit ต่อ user (api.md §12) — ไม่ใช่ open link

## 9. Secrets Management

| Secret                         | เก็บไว้ที่ไหน                                                   | ห้าม                                              |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------- |
| `JWT_SECRET`, `REFRESH_SECRET` | env ของ backend (dev: `.env` ไม่ commit; prod: secrets manager) | ไม่ปรากฏใน client bundle, log, error message      |
| `LAVALINK_PASSWORD`            | env ของ backend + Lavalink container (shared via compose env)   | ไม่ถึง browser (browser ไม่คุย Lavalink อยู่แล้ว) |
| `DATABASE_URL`                 | env เฉพาะ backend                                               | —                                                 |
| Access token                   | memory ของ SPA เท่านั้น                                         | ห้ามลง localStorage/sessionStorage                |
| Refresh token                  | httpOnly cookie (JS อ่านไม่ได้)                                 | ห้ามลง JS-readable storage                        |

- `.env` อยู่ใน `.gitignore` ตั้งแต่ Phase 1; มี `.env.example` (ค่า dummy) เป็นเอกสาร
- Log ต้อง redact: Authorization header, cookies, tokens, password — ทำใน logger wrapper ตั้งแต่ต้น

## 10. Transport & Headers

- HTTPS/WSS เท่านั้นใน production (HSTS เปิด); dev ใช้ localhost ได้
- Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP ตาม §6
- Lavalink/PostgreSQL/Redis: อยู่ใน internal Docker network — ไม่ expose port สู่ host/internet ใน production

## 11. Dependency & Supply Chain

- `npm audit` / lockfile commit (`npm ci` เท่านั้น); renovate/dependabot ใน Phase 13
- Lavalink plugin jar: pin version, ดึงจาก Maven Central เท่านั้น

## 12. Privacy / Logging

- Listening history เป็นข้อมูลส่วนบุคคล — มี "ล้างประวัติ" ใน settings (MVP: ลบทั้งหมด)
- Log ไม่เก็บ query ค้นหาของ user พร้อม identity (สำหรับ MVP — ถ้าต้องเก็บเพื่อ improve search ต้องถาม consent)

## 13. Open Questions

1. ~~Stream auth: query token vs cookie~~ — **ตัดสินใจแล้ว (2026-09-20): cookie-based** (ดู §8 ข้อ 6)
2. ต้องมี email verification + password reset flow ใน MVP ไหม? (ค่าเริ่มต้น: ไม่ — ทำใน phase ต่อ ๆ ไป แต่ออกแบบ users table ไม่ขวางทาง)

## 14. Risks

| Risk                                | ระดับ | บรรเทา (อ้างอิงมาตราข้างบน)                                             |
| ----------------------------------- | ----- | ----------------------------------------------------------------------- |
| SSRF ผ่าน stream proxy              | สูง   | §8 (allowlist + IP check + redirect policy) — มี integration test เฉพาะ |
| XSS ผ่าน track metadata ภายนอก      | กลาง  | §6 (React escaping + CSP + URL sanitizer)                               |
| Credential stuffing ที่ /auth/login | กลาง  | §3 (lockout + rate limit + generic errors)                              |
| Replay/forge playback events (WS)   | กลาง  | §7 (sanity checks + rate limits)                                        |
| Dependency vulnerability            | กลาง  | §11 (audit + lockfile + renovate)                                       |
