# Deploy Guide + Runbook

> Production deployment ของ MusicPlayer — target: **self-hosted เครื่องเดียว** (1–5 users
> ตาม requirements.md) ผ่าน docker compose; deploy จริงแล้ว 1 environment (compose stack)
> ใช้งานได้ end-to-end (E2E J1–J12 วิ่งกับ stack นี้)

## 1. โครงสร้าง

```text
client (browser)
   │  https (reverse proxy ภายนอก)
   ▼
web (nginx :80) ──► SPA static + /api/* + /ws ──► server (Fastify :3001)
                                                    ├─ postgres (:5432, internal)
                                                    ├─ lavalink (:2333, internal)
                                                    └─ resolver (:3002, internal)
```

- **เสียงไหลผ่าน server เท่านั้น** (`/api/v1/stream/:id` — proxy จาก YouTube ผ่าน
  resolver) — client ไม่รู้จัก URL จริงตลอดชีวิต
- postgres / lavalink / resolver ต้องอยู่ internal network — **ห้าม publish port**
  ออก host ใน production (compose dev publish ไว้เพื่อ debug เท่านั้น)

## 2. ขั้นตอน deploy

1. **เตรียมเครื่อง:** Docker Engine + compose plugin
2. **ไฟล์ env:** copy `.env.example` → `.env` แล้วตั้งค่าจริง:
   - `JWT_SECRET`, `REFRESH_SECRET` — สุ่ม ≥ 32 chars (`openssl rand -hex 32`)
   - `COOKIE_SECURE=true` — refresh cookie ใช้ได้เฉพาะ https (จำเป็นเมื่ออยู่หลัง TLS)
   - `CORS_ORIGIN=https://<โดเมนของคุณ>` (หรือไม่ตั้งถ้า same-origin ผ่าน proxy เดียว)
   - `LAVALINK_PASSWORD` — เปลี่ยนจาก default แล้วให้ตรงกับ lavalink/application.yml
3. **TLS:** วาง reverse proxy ออกนอก (caddy / nginx / traefik) หน้า `web:80`:
   - proxy ทุก path ไปที่ web (web จัดการ /api, /ws เอง)
   - **websocket:** ต้องมี `Upgrade/Connection` header สำหรับ path `/ws`
   - เปิด **HSTS** ที่ proxy (`Strict-Transport-Security: max-age=31536000`)
   - `proxy_buffering off` สำหรับ /api/v1/stream/* (มีอยู่ใน nginx.conf ของ web แล้ว)
4. **รัน:** `docker compose up -d --build` — migration วิ่งอัตโนมัติตอน server start
5. **ตรวจ:** `curl http://web:80/api/health` ผ่าน nginx → server `/health` → `{"ok":true}`;
   login สมัคร account แรกผ่าน UI ได้เลย

## 3. Runbook

### 3.1 Backup DB (ทำตามกำหนด เช่น nightly cron)

```bash
# backup (ทุกวัน — เก็บนอกเครื่องด้วยเช่น restic/rclone)
docker compose exec -T postgres pg_dump -U music musicplayer | gzip > backup-$(date +%F).sql.gz

# restore
docker compose exec -T postgres sh -c \
  'createdb -U music -T template0 musicplayer_restore' # ถ้าต้องการ db ใหม่
gunzip -c backup-2026-09-21.sql.gz | docker compose exec -T postgres \
  psql -U music -d musicplayer_restore
```

ตารางที่ขาดไม่ได้: users, tracks, playlists, playlist_items, liked_tracks,
listening_history, queue_snapshots, queue_items, refresh_tokens (การออกเดินทาง session)

### 3.2 Rotation secrets

| secret              | ผลกระทบของการเปลี่ยน                                                   | ขั้นตอน                                                           |
| ------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `JWT_SECRET`        | access token ทุกตัวหมดอายุทันที (user login ใหม่ — ไม่เสีย data)       | แก้ `.env` → `docker compose up -d server`                        |
| `REFRESH_SECRET`    | refresh token ทุกตัว invalid → **logout ทุกเครื่อง** (sign cookie พัง) | แก้ `.env` → restart server; user login ใหม่                      |
| `LAVALINK_PASSWORD` | server ต่อ lavalink ไม่ได้จนตั้งค่าตรง                                 | แก้ทั้ง `.env` + `lavalink/application.yml` → restart สอง service |

> rotation ของ refresh secret ยังทำให้ stream cookie หมดอายุด้วย (cookie ยืนยันด้วย
> refresh token ใน DB จึงไม่กระทบ — เฉพาะตอน user ยังไม่ได้ login ใหม่)

### 3.3 เหตุการณ์ทั่วไป

| อาการ                     | ตรวจ                                     | ทางแก้                                                                                                              |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| เสียงไม่เล่น / stream 502 | `docker compose logs resolver --tail 50` | resolver/yt-dlp เก่า → pull image ใหม่; YouTube block IP → ตรวจ egress                                              |
| search ตอบ 503            | `docker compose logs lavalink server`    | circuit breaker เปิด (Lavalink ตาย) → restart lavalink; server กลับมาเองเมื่อ healthy                               |
| login ไม่ได้ทั้งหมด       | ล่าสุดเปลี่ยน `REFRESH_SECRET`?          | ดู 3.2 — user ต้อง login ใหม่                                                                                       |
| server ช้า                | `docker stats`, `perf/` k6 script        | ตรวจ postgres connections; restart server (in-memory state restore จาก queue_snapshots — user เล่นต่อได้แบบ PAUSED) |

### 3.4 Restart / อัปเดตเวอร์ชัน

```bash
git pull
docker compose build server web resolver
docker compose up -d   # migration วิ่งอัตโนมัติ; queue ค้าง restore จาก DB
```

## 4. เช็คลิสต์หลัง deploy (ต่อครั้ง)

- [ ] `/health` ตอบ ok ผ่าน https
- [ ] `COOKIE_SECURE=true` + HSTS เปิด
- [ ] postgres/lavalink/resolver **ไม่** expose port ออกนอก
- [ ] `.env` บนเครื่อง production ไม่ถูก commit (gitignore ครอบอยู่)
- [ ] backup วิ่งจริงแล้ว (restore ทดสอบแล้วอย่างน้อย 1 ครั้ง)
- [ ] E2E smoke ผ่านกับ stack ที่ deploy (`bun run e2e` — เปลี่ยน BASE_URL)
