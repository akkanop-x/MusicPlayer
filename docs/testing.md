# Testing Strategy

> หลักการ: ยิ่งส่วนไหน "เป็นเอกลักษณ์ของโปรเจกต์" (queue logic, player state, stream proxy, EQ) ยิ่ง test หนัก
> Stack: **Vitest** (unit/integration, ทั้ง frontend/backend — monorepo เดียวใช้ tool เดียว) + **Playwright** (E2E) + **Testcontainers** (PostgreSQL/Lavalink จริงใน integration)

---

## 1. ภาพรวม

```text
Unit tests          — pure logic (queue, state machine, scoring, validation)
                       └─ เร็วมาก, รันทุก commit
Integration tests   — service + DB จริง (Testcontainers), routes + WS (in-process)
E2E tests           — browser จริง (Playwright) กับ stack ครบใน docker compose
Manual QA           — เสียงจริงผ่านหู (สิ่งที่ automated ทดแทนไม่ได้: คุณภาพเสียง, EQ ผลลัพธ์)
```

## 2. Frameworks

| ประสงค์             | เครื่องมือ                                       | เหตุผล                                              |
|---------------------|---------------------------------------------------|------------------------------------------------------|
| Unit / Integration  | Vitest                                             | เร็ว, TS-native, ใช้ร่วมกับ Vite frontend ได้, mock ง่าย |
| API tests           | Vitest + Fastify `inject()` (in-process, ไม่ต้อง port) | ใช้กรอบ integration เดิม                            |
| WS tests            | Vitest + socket.io-client ต่อ in-process server     | ทดสอบ event contract จริง                            |
| DB tests            | Testcontainers (PostgreSQL)                        | schema/migration จริง ไม่ mock DB                    |
| Lavalink integration| Mock server ที่ implement `/v4/loadtracks` จาก spec + (optional) Lavalink container จริงใน CI ช้า | แยกชั้น: contract test กับ mock, smoke test กับของจริง |
| E2E                 | Playwright (chromium, firefox, webkit)             | cross-browser, จับ audio state ได้ผ่าน evaluate     |
| Audio unit (EQ)     | Vitest + OfflineAudioContext                       | ตรวจ frequency response ของ EQ chain ได้แบบ deterministic |

## 3. สิ่งที่ต้อง test แยกตามประเภท

### 3.1 Unit Tests (target coverage: logic สำคัญ ~90%, ทั่วไป ~70%)

| โมดูล                     | กรณีวิกฤตที่ต้องมี                                                 |
|---------------------------|---------------------------------------------------------------------|
| `queueLogic` (shared)     | shuffle แล้ว previous ตาม path จริง (A→D→B→C ตัวอย่างใน queue.md); unshuffle คืนลำดับหลัง mutate; repeat one×skip; repeat all วนรอบ; previous ที่ position>3s = restart; clear/upcoming vs all |
| `playerState` (shared)    | ทุก transition ใน player.md §3; คำสั่งใน state ที่ไม่อนุญาต → error; pauseWhenReady; error auto-advance นับ ≤ 3 |
| `recommendation scoring`  | exclude set ถูกตัดทุกกรณี (current/queue/recent/skipped); diversity penalty; fallback เมื่อ pool ว่าง |
| validation schemas        | ขอบเขตทุกตัว (volume, bands, positionMs, ids)                      |
| `formatDuration`, utils   | ปกติ + edge (live stream, 0, > 1 ชม.)                              |

### 3.2 Integration Tests (backend + DB จริง)

- **API contract:** ทุก endpoint ใน api.md — happy path + error codes ตามตาราง (ใช้ Fastify inject)
- **Auth flows:** register/login/refresh rotation/reuse-detection (token เก่าถูกใช้ซ้ำ → revoke series)/logout
- **Queue persistence:** mutate queue หลายแบบ → restart service (simulated) → restore ได้ state ครบ
- **History criteria:** เล่น < 30 s แล้ว skip ไม่นับ completed; จบเพลงนับ; msPlayed ถูก clamp
- **Lavalink client:** contract test กับ mock (loadType ทั้ง 5 แบบ, timeout, connection refused → fail-soft)
- **Stream proxy:** ✅ สำคัญสุด — ดู §3.5

### 3.3 WebSocket Tests

- Event contract: ทุก event ใน websocket.md มี shape ตรง (typed ทั้งสองฝั่งแล้ว — test ยืนยัน)
- Ordering: version เก่ามาทีหลัง → client-side helper ทิ้งถูก
- Reconnect: kill connection กลางเพลง → reconnect → SYNC_REQUEST ได้ state ล่าสุด
- Multi-tab: tab A play → tab B ได้ TRACK_STARTED และหยุดเสียงตัวเอง
- Position sanity: ปลอม positionMs วิ่งเร็วเกิน → ปฏิเสธ

### 3.4 Player Tests (frontend)

- AudioEngine กับ fake audio element (mock HTMLMediaElement) + real OfflineAudioContext:
  - เปลี่ยน src กลาง LOADING → abort เดิม ไม่มีเสียงซ้อน (นับจำนวน play() ที่ reach speaker)
  - stall → retry 3 ครั้งตาม backoff → TRACK_STALLED
  - seek บน unseekable → reject
- State machine ฝั่ง client sync กับ server events (PlayerStore + WS mock)

### 3.5 Audio Tests (เฉพาะ — คู่กับ security)

- **Stream proxy integration:** Range → 206 + Content-Range ถูก; ไฟล์ใหญ่ได้ครบ bytes; source 5xx → error แมปถูก; **SSRF suite**: URL ที่ resolve ไป 127.0.0.1/private IP/metadata → ปฏิเสธ; redirect ไป host นอก allowlist → ปฏิเสธ; content-type ไม่ใช่ audio/* → ปฏิเสธ
- **EQ graph (OfflineAudioContext):** apply bands → เทียบ magnitude response ที่ความถี่ศูนย์กลางแต่ละ band กับ expected gain (±1 dB); Flat = identity; ไม่มีการ set `.gain.value` ตรง (มี assertion ผ่าน spy บน AudioParam)
- **EQ presets:** seed data valid (ความยาว 10, ∈ [−12,12])

### 3.6 E2E Tests (Playwright, กับ stack ครบใน compose)

Critical journeys (ต้องเขียวก่อน release ทุกครั้ง):

1. สมัคร → ล็อกอิน → ค้นหา → เล่น → ได้ยินเสียง (ตรวจ `audio.currentTime` เดิน + `!audio.paused`)
2. Play → pause → resume → position ต่อเนื่อง
3. เพิ่ม 3 เพลงใน queue → skip × 2 → previous → ตรงเพลงตาม expectation
4. Shuffle on → previous ตาม path จริง (hardcoded scenario)
5. Seek กลางเพลง → เวลา UI + audio ตรง
6. เปิด EQ preset Bass Boost → เสียงไม่หยุด ไม่ error (ผ่าน AudioContext state ตรวจ)
7. Like → refresh → ยัง liked; หน้า liked แสดง
8. Playlist สร้าง → เพิ่มเพลง → เล่นทั้ง playlist ตามลำดับ
9. Autoplay: เล่นจน queue หมด → มีเพลงใหม่เข้า (ใช้ library เล็ก deterministic)
10. Refresh กลางเพลง → "เล่นต่อ" → position ใกล้เดิม (± 5 s)
11. WS หลุด (route abort ชั่วคราว) → เสียงเล่นต่อ → reconnect อัตโนมัติ

> หมายเหตุ: E2E ตรวจ "มีเสียงจริง" ด้วยสถานะ audio element และ AudioContext (แต่ไม่ได้ยินแทนหู — EQ คุณภาพเสียงจริงคือ manual QA)

## 4. Test Data & Fixtures

- Seed: ผู้ใช้ทดสอบ 2 คน, ไฟล์เสียงสังเคราะห์ (sine sweep/silence MP3 ขนาดเล็ก, สร้างตอน build test) — ไม่พึ่งเพลงจริงภายนอกใน automated tests
- Mock Lavalink fixture: ตัวอย่าง response ทั้ง 5 loadType (ตาม lavalink.md §6.1) เก็บเป็น JSON fixture

## 5. CI Layout (Phase 13)

```text
PR / push
├─ lint + typecheck (ทุก package)
├─ unit tests (ทุก package)
├─ integration tests (Testcontainers — ต้องมี Docker)
├─ E2E smoke (chromium only)  ← merge ก่อน
└─ nightly: E2E เต็ม (chromium+firefox+webkit) + Lavalink container จริง
```

## 6. สิ่งที่ตั้งใจไม่ test (ออกจาก scope)

- ตัว Lavalink เอง (ถือว่า upstream tested — เรา test แค่ client contract)
- codec decode ของ browser (ถือว่า browser vendor tested)
- คุณภาพเสียง EQ ด้วยหู — manual QA ด้วย checklist เพลงอ้างอิง

## 7. Assumptions

1. CI มี Docker (สำหรับ Testcontainers/E2E stack)
2. เกณฑ์ coverage เป็นเป้าหมายเชิงสัญญาณ ไม่ใช่ gate ตายตัว (บังคับเฉพาะ `packages/shared` logic)

## 8. Open Questions

1. ~~Visual regression test?~~ — **ไม่ทำ (grilling 2026-09-20):** จุดเสี่ยงคือ logic ไม่ใช่ layout — คุ้มไม่พอกับ cost การดูแล snapshot
2. ~~Load test เมื่อไหร่?~~ — **Phase 13 ด้วย k6 (grilling 2026-09-20):** ยิง `/stream` — แม้ผู้ใช้ 1–5 คนก็ควรมี baseline ของ bandwidth/latency ต่อ stream เพื่อวัดผล optimize ภายหลัง
