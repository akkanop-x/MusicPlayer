# MusicPlayer — Documentation Index

> **สถานะเอกสาร:** Draft v0.2 (Phase 0 — Documentation First, ผ่าน grilling session 2026-09-20)
> **Source of Truth:** โฟลเดอร์นี้คือคำตอบสุดท้ายของ Architecture ก่อนเริ่ม Implementation
> **Glossary:** [CONTEXT.md](../CONTEXT.md) — นิยามศัพท์เฉพาะโปรเจกต์ (Playback History vs Listening History ฯลฯ) อ่านก่อนอ่าน docs
> **กฎ:** ห้ามเขียน Application Source Code จนกว่า Documentation นี้จะได้รับอนุมัติ

---

## 1. Project คืออะไร

**MusicPlayer** คือ Web Music Player ที่ให้ประสบการณ์ใกล้เคียง Spotify / YouTube Music ทำงานใน Browser ทั้งหมด ผู้ใช้สามารถค้นหาเพลง เล่น ควบคุม playback (pause/resume/skip/previous/seek) จัดการ queue (shuffle/repeat/autoplay) จัดการ library (like/playlist/history) และปรับแต่งเสียงด้วย Equalizer

**จุดเด่นทางเทคนิค:** ใช้ **Lavalink v4 เป็น Track Resolution & Search Service** และ **YouTube เป็น catalog หลักแบบ zero storage** (ไม่เก็บไฟล์เพลงลง server เลย — เสียงไหลผ่าน RAM เป็น proxy) โดยมี **Spotify เป็นแหล่ง metadata** (ค้นหา/playlist import/genre — ไม่มีเสียง) ส่วนการเล่นเสียงจริงเกิดที่ Browser ผ่าน Web Audio API (ดู [audio-pipeline.md](./audio-pipeline.md), [ADR-003](./adr/003-audio-pipeline.md), [ADR-008](./adr/008-youtube-first-no-local-storage.md))

**ผู้ใช้เป้าหมาย:** ส่วนตัว/กลุ่มเล็ก **1–5 คน** — ทุก decision เชิง scale ตัดสินจากข้อนี้ (grilling 2026-09-20)

## 2. เป้าหมาย

- ให้บริการ playback แบบเกือบ-instant (เวลาตั้งแต่กด Play ถึงได้ยินเสียง < 1–2 วินาที สำหรับ source ที่ support range requests)
- Player state มี **Backend เป็นผู้กำหนด (authoritative)** เพื่อรองรับ multi-tab / multi-device ในอนาคต
- Architecture ต้อง swap ไปสู่ ML recommendation และ server-side transcoding ได้โดยไม่ rewrite
- Documentation-first: ทุกการเปลี่ยน architecture ต้องผ่าน ADR

## 3. Architecture โดยสรุป

```text
Browser (React SPA)
├── React UI (Tailwind)
├── Player/Queue/UI State (Zustand)
├── AudioEngine: <audio> ← same-origin HTTP stream (Range)
│     └── MediaElementSource → EQ (BiquadFilter × 10) → GainNode → speakers
└── Socket.IO client
        ↕  HTTPS (REST) + WSS (events)
Backend (Node.js + Fastify + TypeScript)
├── API Layer (Controller)
├── Auth / Search / Player / Queue / Playlist / History
│   ├── RecommendationService
│   └── StreamService (proxy + resolver)
│         │
│         ├── Lavalink v4  (REST /v4/loadtracks — metadata/search เท่านั้น)
│         ├── PostgreSQL   (source of truth ของ data)
│         └── Redis        (optional, cache/session — phase ท้าย ๆ)
└── Resolver service (yt-dlp) → YouTube/SoundCloud stream (zero disk)
```

> ⚠️ **ข้อค้นพบสำคัญ:** Lavalink **ส่ง audio ถึง Browser โดยตรงไม่ได้** (มันออกแบบมาเพื่อ Discord voice เท่านั้น) — pipeline ที่ใช้จริงจึงเป็นแบบ hybrid: ดู [audio-pipeline.md](./audio-pipeline.md)

## 4. Tech Stack (สรุป — รายละเอียดและเหตุผลอยู่ใน ADR)

| Layer    | Technology                                                                                    | ADR                                                                                            |
| -------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Language | TypeScript (monorepo: `apps/web`, `apps/server`)                                              | [ADR-001](./adr/001-use-typescript.md)                                                         |
| Frontend | React + Vite + Tailwind CSS + Zustand + TanStack Query                                        | [ADR-005](./adr/005-state-management.md)                                                       |
| Backend  | Node.js + Fastify + Socket.IO                                                                 | [ADR-004](./adr/004-websocket.md)                                                              |
| Audio    | Lavalink v4 (metadata: YouTube+Spotify) + Resolver (yt-dlp, เสียงจาก YouTube) + Web Audio API | [ADR-003](./adr/003-audio-pipeline.md), [ADR-008](./adr/008-youtube-first-no-local-storage.md) |
| Database | PostgreSQL + Drizzle ORM                                                                      | [ADR-002](./adr/002-use-postgresql.md)                                                         |
| Auth     | Session: refresh token rotation (httpOnly cookie)                                             | [ADR-006](./adr/006-authentication.md)                                                         |
| Infra    | Docker / Docker Compose (dev), Redis (optional)                                               | —                                                                                              |

## 5. Documentation Index

```text
Documentation
│
├── Requirements          → requirements.md     (Functional requirements ทุก feature)
├── Architecture          → architecture.md     (System architecture + data flow)
├── Audio Pipeline        → audio-pipeline.md   (⚠️ สำคัญที่สุด — feasibility ของเสียง)
├── Lavalink              → lavalink.md         (ของจริงจาก docs ทางการ v4)
├── Frontend              → frontend.md         (โครงสร้าง React app + state)
├── Backend               → backend.md          (Layered architecture + services)
├── Database              → database.md         (PostgreSQL schema)
├── API                   → api.md              (REST endpoints)
├── WebSocket             → websocket.md        (Realtime events)
├── Player                → player.md           (Player state machine + edge cases)
├── Queue                 → queue.md            (Queue system + shuffle/previous)
├── Recommendation        → recommendation.md   (Rule-based engine + ML interface)
├── Equalizer             → equalizer.md        (Web Audio EQ + presets)
├── Security              → security.md         (Auth/CORS/CSRF/SSRF/secrets)
├── Testing               → testing.md          (Testing strategy)
├── Roadmap               → roadmap.md          (Phase 0–13)
└── ADR                   → adr/                (Architecture Decision Records)
```

## 6. Development Phases (สรุปย่อ)

| Phase | ชื่อ                 | ผลลัพธ์หลัก                             |
| ----- | -------------------- | --------------------------------------- |
| 0     | Documentation        | เอกสารชุดนี้ (✅ คือผลงานของ phase นี้) |
| 1     | Project Setup        | Monorepo + Docker Compose รันได้        |
| 2     | Lavalink Integration | Backend คุยกับ Lavalink /loadtracks ได้ |
| 3     | Audio Pipeline       | Stream + เล่นผ่าน browser ได้           |
| 4     | Player               | State machine + controls ครบ            |
| 5     | Queue                | Add/remove/shuffle/repeat               |
| 6     | Search               | ค้นหา + บันทึก track metadata           |
| 7     | WebSocket            | Sync state แบบ realtime                 |
| 8     | EQ                   | 10-band equalizer + presets             |
| 9     | Frontend             | UI ครบตาม requirements                  |
| 10    | Library              | Playlist / Like / History               |
| 11    | Autoplay             | ต่อ queue อัตโนมัติ                     |
| 12    | Recommendation/Radio | Rule-based engine                       |
| 13    | Testing/Production   | CI + hardening + deploy                 |

รายละเอียดเต็ม: [roadmap.md](./roadmap.md)

## 7. ข้อตกลงเรื่อง Documentation

- เอกสารเป็น Markdown, ใช้ Mermaid diagram ได้
- ทุกไฟล์ต้องมี **Assumptions / Open Questions / Risks / Limitations** (ถ้ามี)
- ห้ามสร้าง API หรือ capability ที่ไม่มีอยู่จริง (โดยเฉพาะ Lavalink — อ้างอิงจาก lavalink.dev v4 เท่านั้น)
- เมื่อ implementation ต้องเบี่ยงจากเอกสาร: แจ้งความแตกต่าง → อธิบายเหตุผล → update เอกสาร → สร้าง ADR (ถ้าเป็น architecture decision)
