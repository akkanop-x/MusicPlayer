# ADR-002: PostgreSQL เป็น Database หลัก (+ Drizzle ORM)

- **สถานะ:** Proposed (รออนุมัติ Phase 0)
- **วันที่:** 2026-09-20

## Context

ข้อมูลของระบบ: users, tracks (metadata cache), playlists + ordered items, likes, listening history (append-heavy, โตเร็ว), settings, EQ presets, queue snapshots รูปแบบ query เด่น: อ่านตาม user + ordering + ค้นหา fuzzy ใน local library + aggregate สำหรับ recommendation (frequently played ฯลฯ) ความสัมพันธ์เชิง relational ชัดเจน (playlist_tracks, liked_tracks, history)

## Decision

ใช้ **PostgreSQL 16** เป็น database เดียว (ไม่ยุ่งหลาย database) พร้อม **Drizzle ORM** สำหรับ data access + migration

## Alternatives

1. **MySQL/MariaDB** — ทำงานได้เกือบเทียบกัน แต่ `pg_trgm`/JSONB/`gen_random_uuid()` ของ Postgres ตอบโจทย์ search + EQ bands (JSONB) + UUID ได้กล่องเดียว
2. **MongoDB** — schema ของเรามี relation จริง (playlist ordering, FK constraints) และ history ต้อง aggregate SQL; document model ไม่คุ้ม
3. **SQLite** — ตัวเลือกที่น่าสนใจสำหรับ MVP (ง่ายกว่ามาก) แต่: listening_history append-heavy + concurrent write จากหลาย session + แผน scale อนาคต → เริ่ม Postgres ตั้งแต่ต้นดีกว่าย้ายทีหลัง (migration ข้อมูล history ไม่สนุก)
4. **ORM ตัวอื่น:** Prisma (engine binary หนักกว่า, SQL escape ยากกว่าตอนจำเป็น), TypeORM (decorator magic, คุณภาพ migration), raw pg (เร็วแต่เสีย type safety และเขียน migration เองทั้งหมด) — **Drizzle** ได้จุดสมดุล: SQL-like API, TS types ดี, migration เป็น SQL จริง review ได้, ไม่มี runtime magic

## Consequences

**บวก:**
- Relation + constraints (RESTRICT/CASCADE) ปกป้องความสมบูรณ์ข้อมูลที่สำคัญ (history อ้างถึง track ที่มีจริง)
- `pg_trgm` ครอบ local search ได้โดยไม่ต้องตั้ง search engine เพิ่ม (Elasticsearch ฯลฯ)
- JSONB เก็บ EQ bands แบบ forward-compatible
- Drizzle: schema-as-code + migration SQL ที่ review ได้ + zero magic

**ลบ:**
- ต้องดูแล migration discipline (ทุก schema change ผ่าน `drizzle-kit generate` + review)
- Postgres ต้องมีใน dev environment (แก้ด้วย Docker Compose ตั้งแต่ Phase 1)

## การประเมินใหม่ (trigger)

- ถ้า fuzzy search ไม่พอ (พินอิน/typos หลายภาษา) → เพิ่ม external search (Meilisearch) โดย Postgres ยังเป็น source of truth
- ถ้า history โตเกิน (partitioning ไม่พอ) → เก็บ aggregate แยก (materialized user stats)
