# ADR-001: ใช้ TypeScript ทั้งระบบ (Full-stack TypeScript Monorepo)

- **สถานะ:** Proposed (รออนุมัติ Phase 0)
- **วันที่:** 2026-09-20

## Context

โปรเจกต์มีทั้ง frontend (React) และ backend (Node.js) และมี "สัญญา" (contracts) ที่ต้องตรงกันสองฝั่งเยอะผิดปกติ: WebSocket event payloads, PlayerState enum, queue logic (pure functions), DTO ของ REST API, validation schema ความผิดพลาดของ contract นี้คือ bug class ใหญ่ที่สุดของแอปแบบ realtime

## Decision

ใช้ TypeScript ทั้ง `apps/web` และ `apps/server` และแชร์ contract ผ่าน package `packages/shared` (playerState enum, queue pure functions, WS event types, API DTOs) จัดการเป็น **bun workspaces monorepo** (เดิม pnpm — ย้ายมา bun 2026-09-20)

## Alternatives

1. **Backend ภาษาอื่น (Go / Java / C#)** — ประสิทธิภาพต่อ connection สูงกว่า แต่: เสีย type sharing กับ frontend (ต้องพึ่ง codegen เช่น OpenAPI/gRPC), ทีม/เครื่องมือต้องรู้สองภาษา, ประโยชน์ด้าน perf ไม่ใช่คอขวดของ MVP (คอขวดคือ bandwidth ของ stream proxy ซึ่ง Node pipe ได้ดี)
2. **JavaScript + JSDoc** — ไม่ต้อง build step แต่ type safety อ่อนกว่ามาก แลกไม่คุ้มกับขนาดโปรเจกต์นี้

## Consequences

**บวก:**

- Contract เดียว compile-time ตรวจทั้งสองฝั่ง (เปลี่ยน event payload → compile error ทั้ง repo)
- queue/player logic เขียนครั้งเดียวใช้สองที่ + test ชุดเดียว
- Tooling ชุดเดียว (Vitest, ESLint)

**ลบ:**

- ต้องดูแล monorepo (workspace protocol, build order)
- Node single-thread: งาน CPU หนัก (ถ้าอนาคตมี transcode) ต้องแยก process/service — แต่ architecture ไม่ขวางทาง (stream worker แยกได้)

## การประเมินใหม่ (trigger)

- ถ้าต้องทำ server-side transcoding จริง (FFmpeg) → แยกเป็น service เฉพาะ ไม่ใช่เปลี่ยนภาษาหลัก
- ถ้า concurrent connections ชนข้อจำกัด Node จริง (> 10k WS) → ประเมิน Go สำหรับ gateway เฉพาะส่วน
