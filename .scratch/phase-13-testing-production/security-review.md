# Security Review — Phase 13 (security.md §1–§12)

ตรวจเมื่อ 2026-09-21 บน main @ `51bab77` (+ hardening ของ phase นี้) — ทุกข้อผ่าน (pass) ยกเว้นที่หมายเหตุ

## §1 Authentication & Authorization — ✅ pass

- Passwords: bcrypt hash (AuthService) — access JWT 15 min + refresh token แยก secret
- Access token อยู่ใน memory เท่านั้น (web: authStore, ไม่เข้า localStorage) — ตรวจ `grep -r localStorage apps/web/src` = 0
- refresh cookie httpOnly + SameSite=Strict (`REFRESH_COOKIE_OPTIONS`), `secure` เปิดผ่าน `COOKIE_SECURE=true` ตอน deploy https (runbook)
- ทุก route ยกเว้น auth/health ผ่าน `requireAuth` (Bearer) — user id จาก JWT เท่านั้น (ไม่รับจาก payload)
- ใหม่ (phase นี้): login rate limit 5/min/IP + account lockout 10 fail/15 นาที → lock 15 นาที, error generic "Invalid email or password" ทั้งกรณีผิด/lock (ไม่ leak) — `security.contract.test.ts`

## §2 CORS & CSRF — ✅ pass

- CORS origin จาก env เดียว (`CORS_ORIGIN`, default same-origin ผ่าน nginx) — ไม่เปิด `*` ใน production
- CSRF: ทุก mutating API ใช้ Bearer (ไม่ใช่ cookie) — cookie (refresh/stream) เป็น SameSite=Strict

## §3 Rate Limiting & Abuse — ✅ pass (เติมใน phase นี้)

- auth 5/min/IP (`AuthGuard`) + lockout — **ใหม่**
- search 30/min/user (`SearchGuard` — มีตั้งแต่ Phase 6)
- player/queue/radio commands 60/min/user (`CommandGuard` — **ใหม่**, GET ไม่นับ)
- stream 60 req/min + ≤ 2 concurrent/user (`StreamGuard` — Phase 3)
- in-memory fixed window ตาม §3 (1–5 users); Redis → ไม่จำเป็น (วัดแล้ว, optional ตาม roadmap)

## §4 Input Validation — ✅ pass

- zod ทุก route (body/query/params) — volume 0–100, positionMs ≥ 0, bands ±12, UUID params
- identity มาจาก JWT เสมอ; ไม่รับ path/file จาก client

## §5 SQL Injection — ✅ pass

- Drizzle ORM parametrized ทั้งหมด; raw `sql` เทมเพลต bind params (ไม่มี string concat ของ input ผู้ใช้) — ตรวจ `recommendation.repo.ts`/`tracks.repo.ts` (sql.join ใช้ param binding)

## §6 XSS — ✅ pass

- `dangerouslySetInnerHTML` = 0 จุดใน apps/web (grep)
- CSP ที่ nginx: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'` (media จาก origin เราเท่านั้น — เสียง proxy ผ่าน /stream)
- metadata จาก YouTube render เป็น text (React escaping)

## §7 WebSocket Security — ✅ pass

- handshake auth JWT (`authenticate()` ใน wsServer — token จาก auth.token/Authorization, reject ไม่มี/เน่า)
- POSITION_SYNC มี validation + sanity (×1.2 speed guard, ≤ duration) — ป้องกันปั้น position/history
- events ทั้งหมด version-gated ต่อ user (ทิ้ง out-of-order)

## §8 Stream Proxy & SSRF — ✅ pass (suite จาก Phase 3 + tests)

- ไม่รับ URL จาก client — target จาก `tracks` table (resolver ที่เราควบคุม) เท่านั้น
- `ssrfFetch`: host allowlist + scheme allowlist, resolve แล้วตรวจ IP (loopback/private/link-local/ULA/metadata), connect ด้วย IP ที่ resolve แล้ว, redirect ≤ 3 hop ตรวจทุก hop, content-type audio/* + stall timeout
- auth ก่อน stream: refresh cookie (httpOnly/Strict) — ไม่มี token ใน URL; rate limit ต่อ user
- tests: `security/ssrf.test.ts` + `StreamService.test.ts` (mock upstream ครบ edge)

## §9 Secrets Management — ✅ pass

- `.env` gitignored (มีตั้งแต่ Phase 1, CI ตรวจ), `.env.example` เท่านั้นที่ track
- JWT_SECRET/REFRESH_SECRET/LAVALINK_PASSWORD ผ่าน env, fail-fast ตอน boot (zod)
- rotation: runbook ใน docs/deploy.md (ใหม่ phase นี้)

## §10 Transport & Headers — ✅ pass (ใหม่ phase นี้)

- API ทุก response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (onSend hook)
- SPA (nginx): CSP + nosniff + Referrer-Policy + X-Frame-Options DENY
- HSTS/HTTPS: ผูกกับ TLS termination ของ reverse proxy ภายนอก — ระบุใน docs/deploy.md (dev/compose ภายในเป็น http ตาม §10 "dev localhost ได้")
- postgres/lavalink/resolver อยู่ internal network — compose ไม่ publish port (ห้ามเปิดใน production: runbook)

## §11 Dependency & Supply Chain — ✅ pass

- lockfile commit (`bun install --frozen-lockfile` ใน CI)
- Lavalink image pin `4.2.2`, youtube-source plugin pin version
- Dependabot (npm/github-actions/docker) — ใหม่ phase นี้; local `bun audit` ไม่มี advisory ระดับ critical ณ วันตรวจ

## §12 Privacy / Logging — ✅ pass

- Fastify logger: ไม่ log body (ไม่มี token/password/stream URL ใน log); request log เฉพาะ meta
- error responses ไม่ส่ง stack/infra detail (apiError shape เดียว)

## สรุป

- ทุกหมวดผ่าน — ของใหม่ phase นี้: auth rate limit + lockout, command guard, security headers (API + nginx CSP)
- เหลือผูกกับ deployment: COOKIE_SECURE=true + HSTS ที่ reverse proxy — อยู่ใน docs/deploy.md
