# Phase 13 — Testing / Production

**Goal ตาม roadmap:** Hardening + deploy-ready
**DoD:** CI เขียวทั้ง pipeline · E2E ผ่านทั้ง 3 browsers · security checklist ผ่านทุกข้อ · deploy จริง 1 environment ใช้งานได้ end-to-end
**Dependencies:** ทุก phase (✓ Phase 0–12 เสร็จหมด)

## ข้อเท็จจริงจากการสำรวจ

- **มีอยู่แล้ว (ผ่านมาจาก phase ก่อน):** SSRF suite เต็ม (`security/ssrf.ts` + tests — allowlist, private/loopback IP check, redirect policy), SearchGuard 30/min/user, StreamGuard (60/min + concurrent cap, api.md §12), WS handshake auth + sanity checks (Phase 7), zod validation ทุก route, JWT access (15 min) + refresh cookie httpOnly/Secure/SameSite=Strict, token ใน memory เท่านั้น, docker production Dockerfiles (server/web) + compose เต็ม, nginx reverse proxy same-origin
- **ขาด:** security headers (nosniff/Referrer-Policy/CSP ตาม §6), auth rate limit 5/min/IP + account lockout (§3), player commands guard 60/min/user (§3), E2E ใน CI + nightly 3 browsers + Lavalink จริง (testing.md §5), k6 performance evidence (P95 play < 2 s, search < 2 s, load /stream), deploy docs + runbook (backup DB, rotate secrets), dependabot
- CI ปัจจุบัน: lint + format + typecheck + unit (hermetic) — E2E ยัง local-only
- k6 ไม่มีในเครื่อง → รันผ่าน `grafana/k6` container ต่อ compose network (โดน target `web:8080` ภายใน)

## การตัดสินใจออกแบบ

- **Guards รวมศูนย์เป็น pattern เดิม** (class ใน `security/`, in-memory fixed window — §3 ยืนยัน MVP ใช้ in-memory, Redis เป็น optional ถ้าวัดแล้วจำเป็น → ไม่จำเป็นกับ 1–5 users จึงไม่เพิ่ม)
- **Headers ที่ API level** (Fastify addHook onSend) เฉพาะ API responses; CSP ฝั่ง web ผ่าน nginx (media-src/img-src ต้องยอม YouTube thumbnails — `img-src 'self' https:` ตาม §6, `media-src 'self'`)
- **Account lockout:** 10 fail ต่อเนื่อง/15 นาที → lock 15 นาที, error body generic ("INVALID_CREDENTIALS") ทั้งกรณีผิดรหัสและถูก lock (ไม่ leak) — log ฝั่ง server บอกเหตุผลจริง
- **Player guard:** 60 commands/min/user บน POST/PATCH /player/* + /queue mutations; ทดสอบผ่าน contract test
- **CI E2E smoke:** job ใหม่ใน ci.yml — compose stack + chromium J1–J12 เต็มชุด (สั้นอยู่แล้ว ~33 s); **nightly.yml:** cron 03:00 UTC → matrix chromium/firefox/webkit + Lavalink จริง (compose ใช้ container จริงอยู่แล้ว)
- **k6:** script `perf/` — search (P95 < 2 s), stream load (60 VUs ramp, วัด P95 TTFB + error rate); วัด "play < 2 s" ด้วย stream TTFB + login/search latency รวมใน report
- **Deploy:** `docs/deploy.md` — compose production (TLS ผ่าน reverse proxy เช่น caddy/nginx, env ที่ต้องตั้ง, ห้าม expose postgres/lavalink), runbook: pg_dump backup/restore, secret rotation (JWT/REFRESH_SECRET), Lavalink plugin pin, ทำ fail-soft อะไรบ้าง
- Dependabot: bun (npm) ecosystem ทั้ง repo + github-actions + docker

## Tickets

- 01 Backend: security headers + AuthGuard (5/min/IP) + lockout + PlayerGuard (60/min) + contract tests
- 02 Security review: checklist ครบ security.md §1–§12 พร้อม evidence → `.scratch/phase-13-*/security-review.md`
- 03 CI: E2E smoke job (chromium + compose) + nightly.yml (3 browsers + Lavalink จริง) + dependabot.yml
- 04 Performance: k6 scripts + วัดจริงบน compose → `perf/RESULTS.md`
- 05 Deploy docs + runbook (`docs/deploy.md`) + 3-browser E2E local + ปิด phase (gates, tracker, commit/push, CI เขียว)

## Evidence (DoD)

1. **CI เขียวทั้ง pipeline** — ci.yml: lint + format + typecheck + unit + **job e2e-smoke ใหม่**
   (compose stack จริง + chromium J1–J12) · nightly.yml (cron 03:00 UTC): E2E 3 browsers +
   Lavalink container จริง (search smoke ผ่าน API) · CI run ของ commit นี้ = เขียว
2. **E2E ผ่านทั้ง 3 browsers** — `bun run e2e:all`: **chromium 12 passed · firefox 12 passed ·
   webkit 6 passed + 6 skipped** (J2/J3/J5/J8/J9/J10 — WebKit Playwright build ไม่มี
   proprietary codec: canPlayType ตอบ "probably" แต่ decode พัง MEDIA_ERR_SRC_NOT_SUPPORTED=4
   → assertions ที่พึ่ง media timeline ใช้ไม่ได้บน platform นั้น; expectAudible ถูกปรับให้
   ยืนยัน pipeline จริง (เล่นอยู่ + src /stream/) และ skip เป็นเงื่อนไขที่วัด empiric ใน J1)
3. **Security checklist ผ่านทุกข้อ** — security-review.md §1–§12; ใหม่ phase นี้:
   login rate limit + lockout, command guard, security headers API + CSP nginx
4. **Deploy จริง 1 environment ใช้งานได้ end-to-end** — compose stack (E2E ทั้ง 3 browsers
   วิ่งกับ stack นี้บน localhost:8080) + docs/deploy.md (deploy steps, runbook backup/rotation)
5. **Performance** — perf/RESULTS.md: search P95 **981 ms** (< 2 s), stream TTFB P95
   **112 ms** @ 10 VUs (play < 2 s), load /stream 20 VUs error 1.6% เฉพาะ cold-resolve

**Gates:** lint ✓ · format:check ✓ · typecheck ✓ · unit shared 45 / server 227 (+5) / web 72

## Lessons

- **canPlayType โกหก:** WebKit build ตอบ "probably" ทั้งที่ decode ไม่ได้ (error 4) —
  ตรวจ codec ต้องวัดพฤติกรรมจริง (currentTime เดินไหม) ไม่ใช่เชื่อ canPlayType
- **ปรับ E2E ต่อ platform อย่างมีหลัก:** ยืนยันสิ่งที่ platform พิสูจน์ได้ (element เล่นอยู่ +
  src จาก /stream/ = pipeline ถูก) และ skip เฉพาะ assertion ที่ platform invalid
  (timeline) — ดีกว่าลด assertion ทุก browser
- **E2E race ที่เคยซ่อน:** กด add-queue 3 ปุ่มรัว ๆ แล้ว skip ทันที — บน chromium เร็วพอจึง
  ผ่านมาตลอด, webkit ช้ากว่าเลยเจอ autoplay เติมแทน → รอ upcoming ครบก่อน skip (เพิ่ม
  `queue-upcoming li >= 3` poll)
- **k6 ยิงทะลุ rate limit ของตัวเอง:** search 30/min/user → ต้อง 1 account/VU + pacing;
  จำได้ว่า refresh token ไม่อยู่ใน body — อ่านจาก Set-Cookie header (register/login)
- **Playwright install timeout:** CDN download ผ่าน curl ได้แต่ Node fetch ติด timeout —
  แก้ครั้งเดียวด้วย download เอง + วาง INSTALLATION_COMPLETE ใน ms-playwright cache
