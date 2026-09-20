# Recommendation Engine

> MVP: **Rule-based** — ไม่มี ML ใน phase แรก
> ออกแบบเป็น pluggable interface เพื่อสลับเป็น ML/collaborative filtering ภายหลังได้โดยไม่แตะ caller

---

## 1. Interface (สัญญาเดียวที่ทั้งระบบรู้จัก)

```ts
interface RecommendationProvider {
  // หน้า home: "แนะนำสำหรับคุณ"
  getHomeFeed(userId: string, limit: number): Promise<TrackDTO[]>;
  // autoplay + radio: ต่อเนื่องจาก seed, ห้ามซ้ำกับ exclude
  getRadioTracks(
    seed: { trackId?: TrackId; artist?: string },
    exclude: Set<TrackId>,
    limit: number,
  ): Promise<TrackDTO[]>;
}
```

- Callers: `GET /recommendations` (home feed), QueueService (autoplay/extend), `POST /radio/start`
- ทุก implementation ต้องประกัน: ผลลัพธ์ **ไม่ซ้ำกับ excludeSet** และ **เล่นได้** (ผ่าน filter ใน §4)

## 2. MVP: RuleBasedProvider

### 2.1 Candidate Generation (เก็บเป็น candidate pool พร้อม score)

| แหล่ง candidate         | เกณฑ์/คำสั่งค้น                                                    | คะแนนฐาน         |
| ----------------------- | ------------------------------------------------------------------ | ---------------- |
| **Same Genre**          | `tracks.genres ∩ seed genres ≠ ∅` (GIN index)                      | +6               |
| Same Artist             | `tracks.artist = ศิลปินของ seed/liked`                             | +4               |
| Same Album              | `tracks.album = อัลบั้มของ seed`                                   | +3               |
| From Liked Tracks       | เพลงที่ user like (ที่ไม่อยู่ใน filter)                            | +5               |
| Recently Played         | history 7 วันล่าสุด (ใช้เป็น signal ทั้ง seed และ filter ตามบริบท) | +3 (seed weight) |
| Frequently Played       | top-N จาก listening_history (count ≥ 3)                            | +4               |
| Co-played (phase ถัดไป) | เพลงที่ถูกเล่นต่อกันบ่อยใน history ของ user                        | (defer)          |

Home feed ใช้ "liked + frequently played" เป็น seed หลัก; radio ใช้ seed track ที่ส่งมา

### 2.1.1 กติกาแนวเพลง (Genre Constraint) — ตัดสินใจจากผู้ใช้ (2026-09-20)

> ผู้ใช้กำหนด: **แนะนำต่างศิลปิน/ต่างอัลบั้มได้ แต่ต้องอยู่ในแนวเพลงเดียวกัน**

- ทุก candidate **ต้องผ่าน genre constraint ก่อนเข้า scoring** (ไม่ใช่แค่คะแนน bonus): `candidate.genres ∩ seedGenres ≠ ∅` — ยกเว้นเมื่อ seed ไม่มี genre เลย (ดู fallback ด้านล่าง)
- `seedGenres` สำหรับ radio = genres ของ seed track; สำหรับ home feed = union ของ genres จาก liked tracks + top frequently played (จำกัด ≤ 5 genres ที่ถี่สุด เพื่อไม่ให้ pool กว้างเกิน)
- Diversity penalty ของ artist ซ้ำ (§2.2) ยังใช้อยู่ — ทำให้ "ต่างศิลปินแนวเดียวกัน" เกิดขึ้นจริง
- **Fallback เมื่อ seed ไม่มี genre:** ใช้ genres ของเพลงที่ user เล่นจบบ่อยล่าสุด 10 เพลง (median ของ user taste) แทน; ถ้า user ยังไม่มี history เลย → คลาย constraint แล้วใช้ same artist/album แทน + บันทึก log ว่า fallback (เพื่อวัดว่าควรเติม genre data ตรงไหน)
- Genre matching normalize ที่ application layer: lowercase + ตัดขีด/ช่องว่าง (เช่น "Hip-Hop" = "hip hop") ก่อนเทียบ — รายละเอียดใน database.md §Assumptions #3
- **แหล่ง genre:** metadata ของ YouTube เอง — yt-dlp `categories` + `tags` ตอน resolve stream (fire-and-forget, fail-soft) ตาม [ADR-009](./adr/009-drop-spotify-youtube-only.md); เก็บ raw tags ไว้เพื่อเพิ่ม mapping layer ภายหลังได้ (ตัดสินใจทางเลือก C — ยังใช้ได้เพราะยังเก็บ raw tags)

### 2.2 Scoring & Diversity

```text
score(candidate) =
    Σ (base ของแต่ละ rule ที่ match)
  + 0.5 × recencyBoost (เพลงที่ user ไม่เคย/นานไม่ได้ยิน ได้ boost เล็กน้อย)
  − ชื่อ artist ซ้ำกับ candidate ก่อนหน้าในผลลัพธ์เดียวกันเกิน 2 ตัว → −4 (กัน wall of same artist)
  + เสี่ยงสุ่มเล็กน้อย (jitter ±1) เพื่อไม่ให้ feed ซ้ำเดิมทุกวัน
```

- Dedupe track ในผลลัพธ์; สุ่มเลือกจาก top candidates (weighted) ไม่ใช่ top-N ตรง ๆ

## 3. Filtering (ห้ามปรากฏในผลลัพธ์)

| Filter            | ที่มา                                           | เหตุผล                                          |
| ----------------- | ----------------------------------------------- | ----------------------------------------------- |
| Current track     | player state                                    | กันเล่นเพลงเดิมซ้ำ                              |
| Already in queue  | QueueState.upcoming                             | กันเพลงที่รอเล่นอยู่แล้ว                        |
| Recently played   | history 50 รายการล่าสุด (สำหรับ radio/autoplay) | กันวนเร็ว (home feed ผ่อนคลายเป็น 20 รายการ)    |
| Skipped tracks    | history ที่ `skipped=true` 20 รายการล่าสุด      | สัญญาณเชิงลบ — เพลงที่ถูก skip ไม่ควรกลับมาเร็ว |
| Unplayable tracks | `content_type` ไม่ supported / stream_url ตาย   | กัน recommend แล้วเล่นไม่ได้                    |

## 4. Data ที่ใช้ (มีอยู่แล้วใน schema — database.md)

- `liked_tracks` (seed + candidate)
- `listening_history` (recent/frequent/skipped — index `(user_id, track_id)`, `(user_id, played_at DESC)`)
- `tracks` (artist/album string matching)

**ข้อจำกัดที่ยอมรับ:** MVP ยังไม่มีตาราง `artists`/`albums` normalized → "Same Artist" ใช้ string equality ของ `tracks.artist` (case-insensitive trim) — แม่นพอสำหรับ metadata จาก source เดียวกัน; หลัง normalize (database.md Open Question #1) จะแม่นขึ้นโดย logic ไม่ต้องแก้ (แค่เปลี่ยน join key)

## 5. ทางไปสู่ ML (เก็บทางไว้ ไม่ implement)

| ขั้น              | ทำอะไร                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Phase 13+ (embed) | เพิ่ม `MlProvider` implement interface เดียวกัน — สลับผ่าน config/DI                          |
| Implicit feedback | มีข้อมูลพร้อมแล้ว: plays, skips, likes, queue adds (ทั้งหมดใน listening_history/liked_tracks) |
| Cold start        | ใช้ rule-based ต่อ (fallback chain: MlProvider → RuleBasedProvider → popular)                 |
| Offline training  | job แยก (นอก API process) — ระบบ API ไม่รู้จัก training เลย                                   |

## 6. Radio specifics

- `POST /radio/start { seedTrackId }`: current = seed, upcoming = getRadioTracks(seed, exclude, 20)
- ทุกเพลงใน radio ต้องผ่าน **genre constraint** ของ seed (§2.1.1) — radio = "สถานีแนวเพลงเดียว"
- ต่อเนื่อง: เมื่อ upcoming เหลือ < 2 → extend เพิ่ม 10 (exclude รวมทุกเพลงที่เล่นไปแล้วใน session นี้, genre constraint คงเดิม)
- Seed เพิ่ม: seed track + artist ของ seed เป็น signal รอง; ถ้าเพลงใน radio ถูกเล่นจบ (ไม่ skip) ให้ weight ศิลปินนั้นเพิ่มเล็กน้อยในการ extend ถัดไป (adaptive แบบง่าย)

## 7. Assumptions

1. ข้อมูล history ของ user ใหม่ ≈ ว่าง → radio/home fallback: ใช้ seed track เอง + same artist (คลาย genre constraint เพราะยังไม่มี taste signal); ถ้าไม่มีเลย → ตอบ empty (UI แนะนำให้ค้นหา/like ก่อน)
2. Recommendation คำนวณ sync ใน request (ไม่มี background job ใน MVP) — query มี index รองรับและจำกัด limit ≤ 30
3. เพลงที่ไม่มี genre tag เลย จะไม่ถูกแนะนำใน radio ที่มี seed genre ชัดเจน (เข้มงวดกว่าการเดา) — แต่ยังโผล่ใน home feed ได้ผ่านทาง liked/frequently played ของ user เอง

## 8. Open Questions

1. ~~"Not interested / ไม่แนะนำเพลงนี้อีก" ใน MVP?~~ — **เลื่อน (grilling 2026-09-20):** skip signal ที่มีอยู่แล้วใน listening_history พอสำหรับผู้ใช้ 1–5 คน; ถ้าทำภายหลัง เพิ่ม table `track_feedback`
2. ~~Cache ผล home feed ต่อ user?~~ — **ไม่ cache (grilling 2026-09-20):** คำนวณสด — query เบอะกับ 1–5 คน; วัดก่อน optimize

## 9. Risks

| Risk                                                  | บรรเทา                                                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Genre tag ในไฟล์ผู้ใช้ไม่ครบ/ไม่ตรงมาตรฐาน → pool แคบ | Ingest script อ่าน tag ให้ครบ + หน้า admin (phase หลัง) แก้ genre มือได้; fallback ตาม §2.1.1                          |
| Filter ทั้งหมดตัดจนไม่เหลือผลลัพธ์                    | ถ้า pool ว่าง → คลาย filter ทีละตัวตามลำดับความเข้มงวด (recently played ออกก่อน, genre constraint ออกเป็นลำดับสุดท้าย) |
| Radio วนเพลงเดิมเมื่อ library ของแนวนั้นเล็ก          | Cap exclude ขนาด (เช่น ล่าสุด 200) ให้ pool หมุนกลับมาได้หลังพ้นหน้าต่าง                                               |
| Query หนักเมื่อ history โต                            | จำกัด subquery ด้วย LIMIT + มี index; วางแผน materialize "user stats" ถ้า P95 > 300 ms                                 |
