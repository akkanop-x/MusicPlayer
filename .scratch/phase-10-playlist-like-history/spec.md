# Phase 10 — Playlist / Like / History

**Goal (roadmap):** Library features ครบ
**Tasks:** PlaylistService + UI (CRUD, reorder), LikeService + UI, HistoryService + หน้า history, LIKES_CHANGED sync
**Dependencies:** Phase 6 (tracks) ✓, Phase 7 (sync) ✓
**DoD:**

1. สร้าง playlist → เพิ่มเพลง → เล่นทั้ง playlist ตามลำดับ (E2E J8)
2. like แล้ว refresh ยังอยู่ + หน้า liked แสดง (E2E J7)
3. history แสดงตามวัน + ถูกต้องตามเกณฑ์ 30 s
4. เปิด E2E J7/J8 ที่เคย skip ไว้ใน Phase 9 — เขียวจริงบน chromium

## แหล่งอ้างอิง

- api.md §5 (queue #20 รับ playlistId), §7 Playlists #26–33, §8 Likes #34–36, §9 History #37
- database.md §2.3 playlists / §2.4 playlist_tracks / §2.5 liked_tracks / §2.6 listening_history (ตารางมีใน migration แล้ว)
- websocket.md §3 LIKES_CHANGED `{ trackId, liked }` — shared: LikesChangedPayload ประกาศไว้แล้ว, RealtimeHub แนบ version ให้เอง
- requirements.md §3.3 + Open Question #1: skip < 30 s โผล่ใน History พร้อม tag `skipped`
- testing.md §3.6 #7/#8 + เกณฑ์ history: "เล่น < 30 s แล้ว skip ไม่นับ completed; จบเพลงนับ; msPlayed ถูก clamp"
- queue.md §9: Listening History (DB) เขียนโดย HistoryService ตอนจบเพลง/เกิน 30 s — แยกจาก playback history ใน queue

## การออกแบบ (ตัดสินใจหลัก)

### Backend

- **Services แยก 3 ตัว** ตามชื่อ roadmap: `PlaylistService`, `LikeService`, `HistoryService` — แต่ละตัวเป็น factory รับ `Db` (pattern เดียวกับ EqService) + `LikeService` รับ `Broadcaster` เพื่อ emit LIKES_CHANGED
- **Routes รวมในไฟล์เดียวต่อ section** (`playlist.routes.ts`, `like.routes.ts`, `history.routes.ts`) ลงทะเบียนใน buildApp ผ่าน `AppDeps.library?` (inject ครบ 3 services สำหรับ contract test; ไม่ส่ง + มี db → สร้างจริง)
- **PlaylistDTO** (shared): `{ id, name, description, coverUrl, trackCount, updatedAt, tracks? }` — tracks เติมเฉพาะ GET /playlists/:id; **HistoryEntryDTO**: `{ id, track, playedAt, msPlayed, completed, skipped }`; **LikesPageDTO/HistoryPageDTO**: `{ items, nextCursor }` (cursor pagination — api.md §13 #1)
- **isLiked decoration:** LikeService มี `decorateTracks(userId, tracks)` (batch query liked_tracks) — ต่อเข้า search routes (ผ่าน SearchService dep เพิ่ม `decorateLiked`) + tracks routes + playlist tracks; player DTO ยัง isLiked=false (นอก scope — hearts แสดงที่ search/library/playlist)
- **Errors:** `LibraryError` คืน code NAME_TAKEN (409), FORBIDDEN (403), NOT_FOUND (404), VALIDATION_ERROR (400), TRACK_NOT_FOUND (404) — map ผ่าน ERROR_STATUS ที่มีอยู่
- **POST /queue/tracks รับ `{ playlistId }`** (api.md #20): queue.routes resolve ผ่าน dep เพิ่ม `getPlaylistTrackIds` → ตรวจจำนวน ≤ 50 แล้วเรียก player.addToQueue เดิม (404 เมื่อ playlist ไม่เจอ)
- **HistoryService.record:** PlayerDeps เพิ่ม callback `onPlaybackEnded(userId, { track, positionMs, reason })` — PlayerService เรียกที่:
  - `reportTrackEnded` → reason "completed" (msPlayed = duration, completed=true)
  - `skip` / `reportStalled` advance / `play` ที่แทนที่เพลงเล่นค้าง → reason "skip" (msPlayed = ctx.positionMs, skipped=true)
  - HistoryService คำนวณ: clamp msPlayed [0, durationMs], completed = reason==="completed", skipped = reason==="skip" — ทุก entry บันทึก (skip < 30 s ก็โผล่ พร้อม tag skipped ตาม requirements.md Open Question #1); เกณฑ์ 30 s ใช้ตอน recommendation (Phase 12) ผ่าน completed/msPlayed ที่เก็บแล้ว
  - PlayerService ไม่รู้จัก HistoryService โดยตรง (ผ่าน dep callback) — contract test เดิมไม่พัง
- **Cursor:** likes/history ใช้ `before`-style cursor (ISO timestamp) — `?limit&cursor` ตาม api.md; nextCursor = likedAt/playedAt ของ item สุดท้ายเมื่อได้ครบ limit

### Web

- **api client:** `playlistsApi` (list/get/create/patch/delete/addTracks/removeTracks/reorder), `likesApi` (list/like/unlike), `historyApi.list`
- **LikeButton** (หัวใจ): optimistic mutation (set query cache ["likes","ids"] ทันที, rollback ตอน error) — ใช้ใน SearchPage rows, PlaylistPage rows, Liked tab, History list
- **LIKES_CHANGED handler** (realtime/handlers.ts): อัปเดต ["likes","ids"] + invalidate ["likes"] (websocket.md consumer: TrackRow hearts + likes cache invalidate)
- **LibraryPage:** แทน empty state ด้วย 3 tab จริง — PlaylistsTab (grid + ปุ่มสร้าง), LikedTab (รายการเพลง + like), HistoryTab (กลุ่มตามวัน: วันนี้/เมื่อวาน/วันที่, tag skipped)
- **PlaylistPage:** แทน placeholder — header (ชื่อ/คำอธิบาย/จำนวน), ปุ่ม "เล่นทั้งหมด" (clear all → POST /queue/tracks {playlistId} → skip เริ่มเพลงแรก — audioEngine.playPlaylist), ปุ่ม shuffle, rows พร้อม remove + reorder (↑/↓ ยิง PATCH order), rename (PATCH)
- **SearchPage:** row เพิ่ม LikeButton + ปุ่ม "+" เปิด AddToPlaylistDialog (เลือก playlist มีอยู่ / พิมพ์ชื่อสร้างใหม่)
- **i18n:** เพิ่ม keys ใน `playlist`/`library`/`history`/`toast` namespaces ทั้ง th/en (test parity เดิมครอบ)

## Out of scope (เลื่อนไว้ภายหลัง)

- cover_url upload (field มีใน schema/DTO แต่ UI ใช้ artwork ของเพลงแรกแทน)
- radio/autoplay (Phase 11/12), E2E J9 ยัง skip
- decorate isLiked ใน queue/player DTO (hearts แสดงเฉพาะ search/library/playlist — queue panel ยังไม่มี heart)
- drag-and-drop reorder จริง (ใช้ปุ่ม ↑/↓ — พอสำหรับ DoD "reorder")

## Tickets

- 01 Backend: shared types (PlaylistDTO/HistoryEntryDTO/LikesPageDTO/HistoryPageDTO) + playlist.repo/likes.repo/history.repo
- 02 Backend: PlaylistService + playlist.routes + contract tests (CRUD + tracks + order + 403/404/409)
- 03 Backend: LikeService + like.routes + contract tests (PUT/DELETE idempotent, cursor, LIKES_CHANGED broadcast) + decorateTracks เชื่อม search/tracks
- 04 Backend: HistoryService + history.routes + contract tests + เชื่อม PlayerService callback (record completed/skip) + queue.routes รับ playlistId
- 05 Web: api clients + hooks (usePlaylists/useLikes/useLikedIds/useHistory + mutations optimistic)
- 06 Web: LikeButton + SearchPage rows + AddToPlaylistDialog + LIKES_CHANGED handler
- 07 Web: LibraryPage 3 tab จริง + PlaylistPage เต็ม (play all/reorder/remove/rename) + i18n
- 08 E2E: เปิด J7/J8 + ปิด phase (unit tests เขียว, lint/format/typecheck, browser smoke, tracker resolved, commit/push, CI เขียว)
