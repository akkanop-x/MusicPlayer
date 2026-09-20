# Queue System Design

> โครงสร้าง queue, การ shuffle ที่ถูกต้อง, previous ที่ใช้ playback history จริง
> Logic ทั้งหมดเขียนเป็น **pure functions ใน `packages/shared/queue`** — backend คือผู้ execute, frontend ได้ผลลัพธ์ผ่าน WS/REST

---

## 1. โครงสร้างหลัก (ต่อ user)

```text
┌────────────── Playback History (stack) ──────────────┐  ┌────────── Upcoming Queue (list) ──────────┐
│  เรียง: ใหม่ → เก่า (push ด้านซ้าย)                  │  │  เรียง: ถัดไป → สุดท้าย                    │
│  [C, B, D, A]                                        │  │  [E, F, G]                                 │
│   ▲ top                                              │  │  (แสดง "Up Next" ตามลำดับนี้)              │
└──────────────────────────────────────────────────────┘  └────────────────────────────────────────────┘
                          กำลังเล่น: อยู่นอกสองโครงสร้าง (current track)
```

- **Playback History ≠ Listening History (DB)** — history ในที่นี้คือโครงสร้าง in-memory สำหรับ previous/เรียงลำดับ; listening_history ใน DB เป็น log ถาวร (บันทึกตามเกณฑ์ 30 s/จบเพลง)
- ทุก QueueItem มี `id` (สุ่ม) — ใช้อ้างตอน remove/move แม้ track ซ้ำใน queue

## 2. Operations

| Operation     | พฤติกรรม                                                                                     |
|---------------|-------------------------------------------------------------------------------------------------|
| add(trackIds) | append ท้าย upcoming; dedupe? **อนุญาตให้ซ้ำ** (เหมือน Spotify)                                   |
| addNext       | insert ต่อจากตำแหน่งแรกของ upcoming (ตำแหน่ง 0)                                                  |
| remove(itemId)| ลบจาก upcoming; ถ้าเป็น current → ทำเหมือน skip; ห้ามลบจาก history (history immutable)           |
| move(itemId, to) | ย้ายภายใน upcoming เท่านั้น                                                                  |
| clear         | `upcoming` เท่านั้น; `clear all` = upcoming + history + current → IDLE                            |
| shuffle(on)   | สับ upcoming เท่านั้น (ไม่แตะ current/history) — เก็บ original order ไว้ (ดู §4)                 |
| unshuffle     | คืน upcoming ตาม original order                                                                |
| skip          | ดู §5 advance()                                                                                |
| previous      | ดู §6                                                                                          |
| repeat        | ผูกกับ advance() — ดู §5                                                                       |

## 3. Model ข้อมูล (in-memory + snapshot)

```ts
QueueState {
  current: QueueItem | null          // กำลังเล่น
  upcoming: QueueItem[]              // [0] คือเพลงถัดไป
  history: QueueItem[]               // [0] คือเพลงที่เพิ่งเล่นจบล่าสุด
  shuffleOrder: number[] | null      // permutation ของ upcoming indices (null = ไม่ shuffle)
  repeatMode: 'off' | 'one' | 'all'
  autoplay: boolean
  radioSeed: TrackId | null          // ถ้ามาจาก radio
}
```

## 4. Shuffle ที่ถูกต้อง

ปัญหาของ shuffle แบบง่าย (sort random ทุกครั้ง): ผู้ใช้กด shuffle สองครั้งได้ลำดับคนละแบบ และ previous พัง

**แนวทาง (แบบ Spotify):**
- เมื่อเปิด shuffle: สุ่ม permutation ครั้งเดียว (`shuffleOrder = shuffleIndices(upcoming.length)` โดยเพลงถัดไปคือ `upcoming[shuffleOrder[0]]`... จริง ๆ คือเก็บ upcoming ตาม original order แล้วเดินตาม shuffleOrder) — **UI แสดง upcoming ตามลำดับ shuffle** เพื่อไม่งง
- เมื่อเพิ่มเพลงใหม่ขณะ shuffle: แทรกเข้า shuffleOrder ตำแหน่งสุ่ม (ไม่ใช่ท้าย)
- เมื่อปิด shuffle: เรียง upcoming กลับตาม `originalPosition` ที่แนบกับ item ตั้งแต่เพิ่มเข้ามา
- history ไม่ถูกสับ — previous จึงเดินตามทางที่เล่นจริงเสมอ

## 5. advance() — หัวใจของการเปลี่ยนเพลง

```text
advance(reason):
  1. ถ้า current ≠ null → history.push(current)   (ยกเว้น reason='previous' ที่จัดการต่างไป)
  2. repeatMode = 'one' และ reason='completed' → current เดิม เล่นซ้ำ (ไม่ push history ซ้ำ)
  3. upcoming มีเพลง → current = upcoming.shift()
  4. upcoming ว่าง:
     a. repeatMode = 'all' → current = เพลงแรกของ "รอบ" (history ของรอบนี้ กลับไป upcoming) → เล่นรอบใหม่
     b. autoplay เปิด → ขอ RecommendationService (exclude = recent history) → current = ตัวแรก, ที่เหลือเข้า upcoming
     c. ไม่งั้น → current = null → ENDED → IDLE
```

- `repeat=all` ไม่ใช่ "ย้าย history ทั้งก้อนกลับ" แบบงี่เง่า แต่เก็บจุดเริ่มรอบ (mark index) — เมื่อจบรอบ ให้ upcoming = เพลงของรอบเดิมตามลำดับต้นฉบับ
- `skip` เมื่อ `repeat=one`: ถือว่าผู้ใช้ตั้งใจข้าม → advance ปกติ (ไม่วนเพลงเดิม)

## 6. previous() — ใช้ history ไม่ใช่ index

**โจทย์:** เปิด shuffle เล่น A → D → B → C กด previous จาก C ต้องได้ B (ไม่ใช่เพลงก่อนหน้าใน array ของ C)

```text
previous():
  1. position > 3000 ms → restart current (seek 0)
  2. history ว่าง → ไม่ทำอะไร (ปุ่ม disabled)
  3. item = history.shift()          // เพลงที่เพิ่งเล่นล่าสุด = B
  4. current ≠ null → upcoming.unshift(current)   // C กลับไปเป็น "ถัดไป"
     (ถ้า current ถูกข้ามเพราะเล่นไม่ได้ → ไม่คืนเข้า upcoming)
  5. current = item → เล่น B
  6. กด previous อีกครั้ง → ได้ D → ได้ A (เดินตามทางที่มาจริง)
```

- ผลลัพธ์ตรงตามตัวอย่างใน requirement: `A → D → B → C` กด previous ที่ C = B, อีกครั้ง = D, อีกครั้ง = A
- history เก็บ position ที่เลิกฟัง → กด previous แล้ว resume ที่ตำแหน่งเดิมได้ (MVP: เริ่มที่ 0 เพื่อความเรียบง่าย — ตัดสินใจ: **เริ่มที่ 0** เพราะ Spotify ก็ทำแบบนี้)

## 7. Radio / Autoplay เติม queue

- เมื่อ `upcoming.length < 2` และ (`autoplay` หรือ `radioSeed ≠ null`) → ขอ recommendation `extend(seed, excludeSet, 10)` ใน background
- `excludeSet` = history ล่าสุด (เช่น 50 เพลง) + current + สิ่งที่อยู่ใน upcoming — กันเพลงวนกลับมาเร็ว
- งานนี้ต้องเกิด **ก่อนเพลงจบ** (เหลือเวลา < 30 s) เพื่อลด gap (player.md #11)

## 8. Persistence

- ทุก mutation → serialize `QueueState` ลง `queue_snapshots` + `queue_items` (upcoming พร้อม `original_position` สำหรับ unshuffle; history เก็บล่าสุด 100 รายการพอ)
- Restore หลัง backend restart: state กลับมาเป็น PAUSED ที่ position ที่ snapshot
- Listening history (DB) บันทึกแยกโดย HistoryService เมื่อเพลงจบ/เล่นเกิน 30 s

## 9. Edge Cases

| กรณี                                        | พฤติกรรม                                                     |
|----------------------------------------------|------------------------------------------------------------------|
| เพิ่มเพลงซ้ำ 10 ครั้ง                       | อนุญาต; queue มี 10 items ที่ track เดียวกัน (id ต่างกัน)         |
| ลบ current track                             | = skip (advance)                                                  |
| unshuffle หลังจากเพิ่ม/ลบ/ย้ายเพลงไปแล้ว    | คืนตาม original_position ของ items ที่เหลือ (สิ่งที่ถูกลบหายไปตาม) |
| shuffle แล้ว previous จนหมด history          | ปุ่ม disabled; เล่น current ต่อ                                  |
| previous แล้วเพลงใน history ถูกลบจากระบบ    | ข้ามไปเพลงก่อนหน้าใน history (track ถูก mark deleted → ไม่เล่นได้) |
| repeat=all กับ queue 1 เพลง                  | เล่นเพลงเดียววนไปเรื่อย ๆ (เท่า repeat=one ทางปฏิบัติ)             |
| radio + ผู้ใช้ลบเพลงที่เพิ่งถูก recommend     | เติมใหม่ครั้งถัดไป exclude เพลงนั้นด้วย                            |

## 10. สิ่งที่ต้อง test ให้ครบ (โยงไป testing.md)

- shuffle → previous หลายชั้น ตรงตาม path จริง
- unshuffle คืนลำดับเดิมแม้ผ่านการ mutate
- repeat one/all × skip/previous/ended ทุก combination
- autoplay ไม่แนะนำเพลงใน excludeSet
- restore หลัง restart ได้ current + upcoming + history ครบ

## 11. Assumptions

1. Queue ต่อ user มีขนาดจำกัด (cap 500 items) — กัน memory/abuse
2. History ใน memory เก็บ 100 รายการล่าสุด (previous ไม่ต้องไปไกลกว่านั้น)
3. ทุก track ใน queue ต้องมี record ใน `tracks` table ก่อน (SearchService upsert แล้วเสมอ)

## 12. Open Questions

1. เพิ่มเพลงซ้ำใน queue ควรเตือน duplicate ไหม? (ค่าเริ่มต้น: ไม่เตือน, แสดง badge จำนวนเพลงซ้ำเล็ก ๆ พอ)
2. ~~`previous` ควร resume ตำแหน่งเดิมไหม?~~ — **ตัดสินใจแล้ว (grilling 2026-09-20): เริ่มที่ 0 เสมอ** — ตรง behavior ของ Spotify; ไม่เก็บ position ต่อ history item
