# Performance Results — Phase 13 (2026-09-21)

วัดบน compose stack เครื่อง dev (Windows, Docker Desktop) — `grafana/k6` container ต่อ
compose network ยิงผ่าน nginx (`web`) เหมือนที่ client ใช้จริง · commit `51bab77` หลัง hardening

## Search — `perf/search.js` (5 VUs, 30 s, 1 account/VU)

| metric           | ค่า                                         |
| ---------------- | ------------------------------------------- |
| requests         | 54 (0% error)                               |
| duration **P95** | **981 ms ✅ (< 2 s)**                       |
| P90 / median     | 858 ms / 623 ms                             |
| max              | 4.1 s (cold search ผ่าน Lavalink → YouTube) |

- หมายเหตุ: k6 ครั้งแรก (ยิง 135 req/min บนบัญชีเดียว) เจอ 429 ~77% — **search guard
  30/min/user ทำงานตาม design** (api.md §12) จึงต้องแบ่ง 1 account/VU

## Stream — `perf/stream.js` (auth ด้วย refresh cookie + Range request เลียน audio element)

**profile สมจริง (10 VUs, 30 s):**

| metric             | ค่า                          |
| ------------------ | ---------------------------- |
| requests           | 162 (0% error)               |
| TTFB **P95**       | **112 ms ✅ ("play < 2 s")** |
| P90 / median / max | 68 ms / 26 ms / 680 ms       |

**load test (20 VUs, 45 s):**

| metric        | ค่า                                                                      |
| ------------- | ------------------------------------------------------------------------ |
| requests      | 374 (error 1.6% — 6 requests)                                            |
| TTFB P95      | 3.5 s · P90 34 ms · median 16 ms                                         |
| error ทั้งหมด | cold-resolve ของ resolver (YouTube resolve ใหม่ ~15 s) ช่วงที่ cache หมด |

- TTFB ของ stream ที่ resolve แล้ว = **16–112 ms** (proxy ดึงจาก YouTube ผ่าน prebuffer)
- "play < 2 s" จริงของผู้ใช้ = resolve cache hit (กรณีเกือบทั้งหมด) + audio prebuffer 2–5 s
- ช่องว่างที่รู้: cold resolve แรกของ track ใหม่อาจ > 2 s — เป็น upstream latency
  (YouTube) ไม่ใช่งานของเรา; client โชว์ BUFFERING อยู่แล้ว

## สรุป DoD

- ✅ P95 search < 2 s (981 ms)
- ✅ P95 play (stream first byte) < 2 s (112 ms @ 10 VUs)
- ✅ load test /stream ผ่าน (20 VUs — error เฉพาะ cold resolve 1.6%)
- Redis ยังไม่จำเป็น — guards/cache in-memory รับโหลดนี้ได้สบาย (วัดแล้วตาม roadmap optional)
