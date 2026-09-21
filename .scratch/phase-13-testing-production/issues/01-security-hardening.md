# 01-security-hardening

Status: resolved

- 01 Backend — security headers + AuthGuard(5/min/IP) + AccountLockout(10 fail/15min→lock 15min, error generic) + CommandGuard(60/min/user บน player/queue/radio; GET ไม่นับ) + nginx CSP (default-src 'self', media-src 'self', img-src https:) + contract tests 5 ใหม่ (security.contract.test.ts; server 227)
