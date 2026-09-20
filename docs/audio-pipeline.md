# Audio Pipeline

> ⚠️ **ไฟล์นี้คือไฟล์ที่สำคัญที่สุดของโปรเจกต์** — วิเคราะห์ความเป็นไปได้จริงของ pipeline เสียง
> ความเชื่อที่ผิดที่พบบ่อย: _"Lavalink ส่ง audio ไป browser ได้"_ → **ไม่ได้** (พิสูจน์ด้านล่าง)
> คู่กับ [ADR-003](./adr/003-audio-pipeline.md)

---

## 1. Feasibility ของ Pipeline ที่ตั้งใจไว้

Pipeline ที่เขียนมาใน requirement ตั้งต้น:

```text
Music Source → Lavalink → Audio Stream → Browser → Web Audio API → EQ → Volume → Speakers
```

### 1.1 Lavalink ทำอะไรได้จริง (อ้างอิง lavalink.dev — Lavalink v4)

| ความสามารถ                                               | มีจริง? | หมายเหตุ                                                                                                                                                    |
| -------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ค้นหา/resolve track จากหลาย source                       | ✅      | `GET /v4/loadtracks?identifier=ytsearch:...` คืน metadata + `encoded`                                                                                       |
| Decode track / metadata                                  | ✅      | `GET /v4/decodetrack`, `POST /v4/decodetracks`                                                                                                              |
| เล่นเพลง + seek/volume/filters                           | ✅      | แต่เล่นผ่าน **Discord voice connection เท่านั้น** (ส่ง Opus ทาง UDP ไป Discord voice server)                                                                |
| ส่ง audio stream ออกทาง HTTP/WebSocket ให้ client ทั่วไป | ❌      | **ไม่มี endpoint นี้ใน v4 และไม่มีแผนมี** — Lavalink ออกแบบมาเป็น "audio sending node" ของ Discord bot                                                      |
| คืน direct stream URL จาก loadtracks                     | ❌      | ฟิลด์ `uri` คือ source page URL (เช่น `https://youtube.com/watch?v=...`) ไม่ใช่ media URL — stream จริงถูก resolve ภายใน Lavaplayer ตอนเล่นและไม่ถูก expose |

**สรุป:** ขั้น `Lavalink → Audio Stream → Browser` **ทำไม่ได้โดยตรง** ไม่ว่าจะ config หรือเขียน plugin แค่ไหนก็ตามที่เป็น Lavalink v4 ปกติ — Lavalink ไม่มี "audio output to non-Discord client" ให้ต่อ

### 1.2 แล้วเสียงไปถึง Browser ได้อย่างไร?

เบราว์เซอร์เล่นเสียงได้ 3 ทางหลัก:

| ทาง                             | กลไก                                                          | เหมาะกับเรา?                                                               |
| ------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `<audio>` / `Audio()` element   | Browser จัดการ fetch+decode เอง, รองรับ HTTP Range (seek ได้) | ✅ **เลือกทางนี้**                                                         |
| MediaSource Extensions (MSE)    | ป้อน segment เอง (เหมือน HLS.js/DASH.js)                      | ยังไม่จำเป็น — ใช้เมื่อทำ adaptive bitrate / server-side transcode ในอนาคต |
| WebAudio `AudioBuffer` ทั้งก้อน | โหลดไฟล์ทั้งไฟล์มา decode                                     | ไม่เหมาะ — กิน RAM, seek ลำบาก                                             |

ทางที่เลือก: **Backend สตรีม audio bytes ให้ browser ผ่าน HTTP (รองรับ Range requests) แล้วให้ `<audio>` element เล่น** โดยต่อเข้า Web Audio API เพื่อทำ EQ

---

## 2. Architecture ที่เลือก (Hybrid: Lavalink resolves, Browser renders)

> **ตัดสินใจจากผู้ใช้ (2026-09-20, [ADR-008](./adr/008-youtube-first-no-local-storage.md)):** YouTube เป็น catalog หลัก, **ไม่มีการเก็บไฟล์เพลงลง disk เลย** — เสียงไหลผ่าน RAM ของ backend เป็น proxy แล้วหายไป

```text
        ┌──────────── SEARCH / RESOLUTION (control path) ────────────┐
        │                                                              │
Search ──► Backend SearchService ──► Lavalink v4 /v4/loadtracks       │
        │        (upsert metadata ลง PostgreSQL: tracks)              │
        └──────────────────────────────────────────────────────────────┘

        ┌──────────── PLAYBACK (data path — zero storage) ────────────┐
        │                                                              │
Browser │  <audio src="/api/v1/stream/{trackId}">                      │
        │     │  (HTTP GET + Range: bytes=...)                         │
        │     ▼                                                        │
        │  Backend StreamService (in-memory proxy)                     │
        │     ├─ resolve: trackId → stream URL (ผ่าน resolver          │
        │     │    service แยก container — yt-dlp based, URL อายุสั้น) │
        │     ├─ prebuffer 2–5 s แรกก่อนส่งกลับ                        │
        │     ├─ fetch bytes จาก YouTube (pipe ผ่าน RAM ไม่ลง disk)    │
        │     └─ ต่อ Range header และ 206 response กลับไป               │
        │     ▼                                                        │
        │  Browser: decode เอง + buffer ล่วงหน้าอัตโนมัติ ~30–60 s      │
        │     ▼                                                         │
        │  MediaElementAudioSourceNode                                  │
        │     ▼                                                         │
        │  EQ: BiquadFilterNode × 10 (peaking/shelf)                   │
        │     ▼                                                         │
        │  GainNode (volume สุดท้าย) ──► AudioContext.destination       │
        └──────────────────────────────────────────────────────────────┘
```

**หน้าที่แบ่งชัดเจน:**

| ใคร                              | ทำอะไร                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Lavalink                         | แปลง "คำค้น/ลิงก์" → track metadata มาตรฐาน (ไม่แตะเสียงเลยแม้แต่เพลงเดียว)    |
| Resolver service (แยก container) | แปลง trackId → stream URL ที่ใช้ได้ (URL มีอายุสั้น + ผูก IP ของ server)       |
| Backend                          | เป็นแหล่งสตรีมเดียวที่ browser รู้จัก (same-origin) + intent state + prebuffer |
| Browser                          | Decode + buffer ล่วงหน้า + EQ + volume ทั้งหมด (Web Audio API)                 |

## 3. Audio Transport & Codec

### 3.1 Transport: HTTP progressive + Range requests

- Browser ขอ `GET /api/v1/stream/{trackId}` พร้อม header `Range: bytes=N-`
- StreamService resolve stream URL (จาก resolver service — URL ของ YouTube อายุสั้นและผูกกับ IP ของ server ซึ่ง fetch ทันที) แล้ว pipe bytes ผ่าน RAM กลับไปพร้อม `206 Partial Content` + `Content-Range`, `Content-Length`, `Accept-Ranges: bytes`
- ทำไมต้องผ่าน proxy ไม่ให้ browser ดึงจาก source ตรง ๆ (**hard constraint** — ไม่ใช่ตัวเลือก):
  1. **CORS** — YouTube/Google ไม่ส่ง `Access-Control-Allow-Origin` → MediaElementSource จะ output เสียงเงียบ (CORS-tainted)
  2. **URL อายุสั้น + ผูก IP** — stream URL ใช้ได้เฉพาะ IP ที่ขอมา (server) และหมดอายุในไม่กี่นาที
  3. **Security** — ไม่เปิดเผย stream URL ให้ client, ป้องกัน SSRF จากฝั่ง client
  4. **เสถียร** — client เห็น URL คงที่ (same-origin) ต่อ cache ได้

### 3.2 Codec

- Browser decode เอง (ไม่มี transcode ฝั่ง server ใน MVP)
- Source หลักคือ YouTube → formats จริงที่ resolver คืนคือ **Opus (webm) หรือ AAC (m4a)** — รองรับทุก browser ปัจจุบัน; เผื่อ source อื่น (SoundCloud = MP3/AAC/Opus)
- **ข้อจำกัด:** ถ้า format ใด browser นั้นไม่รองรับ เพลงนั้นเล่นไม่ได้ → StreamService ตรวจ content-type ตอน resolve และ mark track ว่า `unsupported` พร้อมเหตุผล (แสดงใน UI) — ไม่มี transcode ใน MVP (เปิดทางไว้ใน §Alternative B)

### 3.3 Browser Compatibility

- `MediaElementAudioSourceNode`: รองรับทุก browser ปัจจุบัน (Chrome/Edge/Firefox/Safari)
- ⚠️ **ข้อจำกัดสำคัญของ MediaElementSource:** ต่อ element เข้า Web Audio ได้ **ครั้งเดียวต่อ element** — ต้องสร้าง `<audio>` element ครั้งเดียวตอน boot แล้วเปลี่ยนแค่ `src` (ดู player.md §implementation constraints)
- Autoplay policy: `AudioContext` เริ่มใน state `suspended` จนกว่าจะมี user gesture → AudioEngine ต้องเรียก `ctx.resume()` ใน click handler แรกเสมอ

## 4. Latency Budget (กด Play → ได้ยินเสียง)

```text
[Play click]                     0 ms
├─ REST play + WS TRACK_STARTED   ~50–150 ms
├─ resolve stream URL (resolver)  ~300–1,500 ms (yt-dlp extract — ชุดนี้คือตัวแปรใหญ่สุด)
├─ server prebuffer 2–5 s         ~200–600 ms (ดึงช่วงแรกจาก YouTube)
├─ HTTP first bytes (TTFB)        ~100–300 ms
├─ Browser decode + first frame   ~100–300 ms
└─ ได้ยินเสียง                     เป้าหมาย < 2,500 ms (P95 — เผื่อ resolver)
```

การลด latency:

- ยิง `GET /stream` ทันทีที่ได้ trackId (ไม่รอ WS round-trip)
- Cache stream URL ต่อ trackId อายุสั้น (เช่น 60 s) — เพลงที่ seek ถี่ ไม่ต้อง resolve ใหม่ทุกครั้ง
- Preload เพลงถัดไป: เมื่อเพลงปัจจุบันเหลือ < 30 s → resolve + warm connection stream ถัดไป
- `preload="auto"` บน audio element

## 4.1 Buffering Strategy (ตัดสินใจแล้ว — ADR-008)

```text
YouTube ──(fetch)──► [ server RAM: prebuffer 2–5 s ] ──(pipe + Range)──► [ browser buffer ~30–60 s ] ──► speakers
                         ไม่ลง disk ตลอดอายุ pipeline
```

| คนเติม buffer          | ทำอะไร                                | ทำไม                                                       |
| ---------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Server (StreamService) | เก็บช่วงแรก 2–5 s ไว้ก่อนเริ่มส่งกลับ | กัน YouTube ตอบช้า/กระตุกช่วงต้น ทำให้ "กด play แล้วเงียบ" |
| Browser (`<audio>`)    | ดึง Range ล่วงหน้า ~30–60 s อัตโนมัติ | network กระตุกภายหลังไม่กระทบเสียงทันที                    |

- **ห้าม fetch ทั้งเพลงเข้า RAM** — เวลาเริ่มเล่นช้าลง, RAM โตตาม listener (~1 MB/นาที/คน), จังหวะดึงเร็วผิดปกติเสี่ยงถูก YouTube rate-limit
- Whole-track RAM cache (per-track, สำหรับเพลงยอดฮิต) และ MSE → เก็บเป็น optimization เมื่อวัดแล้วเจอปัญหาจริง (trigger ดูใน ADR-008)

## 5. Seeking

- Mechanism: เปลี่ยน `currentTime` ของ audio element → browser ยิง Range ใหม่ → proxy ต่อไปยัง source
- ไฟล์/source ที่ไม่รองรับ range (บาง HTTP stream แบบ chunked) → track ถูก mark `isSeekable=false` (ตรงกับ field `isSeekable` ของ Lavalink track info) → UI disable progress bar
- Live stream (`isStream=true`): disable seek เช่นกัน, duration = ∞
- Backend ต้องอัปเดต authoritative position ทุกครั้งที่รับ seek command

## 6. Track Switching & Gapless

- Track switching: เปลี่ยน `src` ของ audio element เดิม + `load()` → เกิด gap ~0.5–2 s (ยอมรับได้ใน MVP — Spotify ก็ไม่ gapless บน web)
- ลดช่องว่าง: prebuffer เพลงถัดไปด้วย element ที่สอง (ซ่อน) แล้วสลับตอนเพลงเกือบจบ — บันทึกไว้เป็น **optimization ภายหลัง** เพราะ Web Audio graph ต้อง rewire ทุกครั้ง (MediaElementSource ผูก element)
- Autoplay ต้อง fetch recommendations ก่อนเพลงจบ ≥ 10 s ไม่งั้นเกิดช่องว่าง

## 7. Reconnection & Resilience

| เหตุการณ์             | พฤติกรรมที่ต้อง implement                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network drop กลางเพลง | audio element เกิด `stalled`/`error` → AudioEngine retry 3 ครั้ง (backoff 1s/2s/4s) จาก position ล่าสุด → ถ้า fail ส่ง `TRACK_STALLED` ให้ backend ข้ามเพลง |
| WS ขาด                | เสียงเล่นต่อ (stream ไม่ผ่าน WS) → reconnect backoff → `SYNC_REQUEST` ดึง state ล่าสุด → ถ้า backend บอกเพลงเปลี่ยนไปแล้ว ให้สลับตาม                        |
| Refresh หน้าเว็บ      | โหลด player state จาก REST (`GET /api/v1/player`) → กด play ต่อจาก position เดิม (autoplay policy บังคับให้มี gesture ก่อน — แสดงปุ่ม "เล่นต่อ")            |
| Backend restart       | Player/queue state ถูก snapshot ลง DB → restore ตอน boot; client reconnect แล้ว resync                                                                      |

## 8. EQ Processing (สรุป — รายละเอียดใน equalizer.md)

- Chain: `MediaElementSource → [BiquadFilter × 10] → GainNode → destination`
- ค่า band มาจาก backend (`GET /api/v1/settings/eq` + push ผ่าน WS เมื่อเปลี่ยน) แต่ **การประมวลผลเกิดที่ browser ทั้งหมด** — backend ไม่แตะเสียง
- ปรับ gain ด้วย `setTargetAtTime` เพื่อไม่เกิด click/pop ระหว่างเพลง

## 9. Volume

- ใช้ `GainNode` (อยู่หลัง EQ) เป็นหลักเพื่อให้ slider ลื่นแบบ programmatic + จำค่า user-level
- Sync ค่า volume ผ่าน backend → อุปกรณ์อื่นใช้ค่าเดียวกันได้

## 10. ทางเลือกที่พิจารณาแล้ว (สรุป — ฉบับเต็มใน ADR-003)

| ทางเลือก                                                                        | ผลลัพธ์                                                                                                                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Lavalink ส่งเสียงถึง browser โดยตรง                                          | ❌ ไม่มีอยู่จริง                                                                                                                                       |
| **B. (เลือก) Lavalink resolve + backend proxy + browser render ผ่าน Web Audio** | ✅ MVP เร็ว, EQ ทำที่ client ได้ฟรี, latency ต่ำ                                                                                                       |
| C. Server-side transcode (FFmpeg → HLS/ICY) → MSE ที่ browser                   | ⏸ หนัก (CPU), latency HLS สูง (2–6 s) — เก็บไว้เป็นทางเลือก phase ถัดไป เมื่อต้องการ server-side EQ จริง / sync หลายอุปกรณ์แบบเป๊ะ ๆ / transcode codec |
| D. ทิ้ง Lavalink ใช้ extractor เอง (yt-dlp) ทำทั้ง search+resolve               | ⏸ ง่ายกว่า operationally แต่เสีย ecosystem ของ Lavalink (LavaSrc ฯลฯ) — ตาม requirement ผู้ใช้ต้องการ Lavalink จึงคงไว้ในบทบาท resolver                |

## 11. Assumptions

1. **Source หลักของ MVP = YouTube/YT Music ผ่าน Lavalink (search) + resolver (stream URL)**; **metadata มาจาก YouTube เท่านั้น** (ถอด Spotify ออกทั้งสแตก 2026-09-20 — [ADR-009](./adr/009-drop-spotify-youtube-only.md)); **SoundCloud เลื่อนออกจาก MVP** — ตัดสินใจโดยผู้ใช้ 2026-09-20 ([ADR-008](./adr/008-youtube-first-no-local-storage.md) + grilling session)
2. **ไม่มีการเก็บไฟล์เพลงลง disk ตลอดทั้งระบบ** — stream ผ่าน RAM เท่านั้น; local file ingest เป็น optional fallback (Phase 14)
3. ผู้ฟังหนึ่งคนใช้ browser เดียวในเวลาเดียวกัน (MVP); ผู้ใช้ทั้งหมด 1–5 คน

## 12. Technical Limitations (ยอมรับอย่างชัดเจน)

1. **ไม่ gapless** — เปลี่ยนเพลงมีช่องว่างเล็กน้อย
2. **EQ ทำที่ client** — ผู้ใช้ที่แก้ client บายพาส EQ ได้ (ไม่ใช่ use case ความปลอดภัย)
3. **Codec ตาม browser** — ไม่มี transcode (YouTube formats = Opus/AAC รองรับหมด จึงไม่ใช่ปัญหาในทางปฏิบัติ)
4. **Backend เชื่อ playback events จาก client** — ต้องมี sanity check (ดู architecture.md §Risks)
5. **Bandwidth ผ่าน server 100% ×2** (ดาวน์โหลดจาก YouTube + ส่งออก client) — ต้นทุนโฮสติ้งโตตาม usage
6. **Single-source dependency:** YouTube extraction พัง = ทั้งแอปไม่มีเพลงเล่น (บรรเทา: resolver แยก container อัปเดตง่าย + local fallback Phase 14)
7. **Stream URL อายุสั้น + ผูก IP server** — resolve ใหม่ได้ทุกเมื่อแต่ต้อง cache อย่างระวังอายุ (ค่า default: cache 60 s)
8. **Seek บน source ที่ไม่รองรับ range ไม่ได้** — YouTube รองรับ range ดี จึงไม่ใช่ปัญหาในทางปฏิบัติ แต่ logic `isSeekable` ยังต้องมี

## 13. Open Questions

1. ~~Resolver ควรเป็น process pool ใน backend หรือ service แยก?~~ — **ตัดสินใจแล้ว (ADR-008): Docker container แยก** เพื่อ isolate CPU/dependency/crash
2. ~~Preload เพลงถัดไปด้วย audio element ที่สอง?~~ — **เลื่อน (grilling 2026-09-20):** ทำเมื่อวัด gap แล้วรู้สึกแยกจริง — เพิ่ม Web Audio rewiring complexity
3. ~~ต้อง normalize loudness ตอน ingest ไหม?~~ — ingest ไม่มีแล้ว (zero storage) → loudness ต่อเพลงจาก YouTube ต่างกันได้; ทางแก้ runtime คือ DynamicsCompressor ที่มีอยู่แล้วใน EQ chain (equalizer.md §7)
4. ~~ย้าย search จาก Lavalink ไปให้ resolver ทำทั้งหมด?~~ — **ไม่ (grilling 2026-09-20):** คง Lavalink (youtube-source) เพราะได้ metadata ของ YouTube/YTMusic จากชุด contract เดียว; Spotify ถูกถอดออกภายหลัง ([ADR-009](./adr/009-drop-spotify-youtube-only.md))

## 14. Risks

| Risk                                                              | ระดับ   | บรรเทา                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSRF ผ่าน stream proxy                                            | สูง     | ออกแบบ guard ไว้ใน security.md §stream-proxy (allowlist, บล็อก private IP, resolve แล้วตรวจ IP ก่อน fetch)                                                                |
| **YouTube extraction พัง = ไม่มีเพลงเล่นทั้งแอป** (single-source) | **สูง** | resolver แยก container อัปเดต dependency ง่าย + หน้า source status + local ingest เป็น fallback (Phase 14)                                                                |
| Bandwidth ผ่าน backend ×2 (ทุกวินาทีที่ฟัง)                       | **สูง** | รับได้ใน MVP; trigger แก้: per-track RAM cache / CDN / self-hosted (ADR-008 §ประเมินใหม่)                                                                                 |
| ถูก YouTube rate-limit/block IP จาก traffic จริง                  | กลาง    | rate limit ต่อ user + จำกัด concurrent streams ≤ 2 + prebuffer เท่านั้น (ห้าม fetch ทั้งเพลง)                                                                             |
| YouTube ไม่มี genre tag → recommendation แนวเพลงพัง               | กลาง    | genre enrichment จาก metadata ของ YouTube เอง (yt-dlp categories/tags ตอน resolve stream) — ไม่มี external dependency ([ADR-009](./adr/009-drop-spotify-youtube-only.md)) |
| Safari MediaElementSource พฤติกรรมต่างจาก Chrome                  | กลาง    | มี E2E test ครอบ Safari (ดู testing.md)                                                                                                                                   |
