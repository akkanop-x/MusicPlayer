# 04 — PlayerBar เต็ม + NowPlaying + Media Session

Status: resolved

## งาน

- PlayerBar: เพิ่มปุ่ม shuffle (PATCH /player/shuffle — QueueStateDTO กลับมา) + ปุ่ม
  ขยาย NowPlaying; เรียง responsive ให้พอดีจอเล็ก
- `components/player/NowPlayingView.tsx`: fullscreen overlay (artwork/ชื่อ/seek/volume/
  ปุ่มครบ) — UI state `isNowPlayingFullscreen` ใน playerStore
- `lib/mediaSession.ts`: metadata ตอน track เปลี่ยน (title/artist/album/artworkUrl) +
  action handlers play/pause/previoustrack/nexttrack/seekto → engine + `playbackState`
  - `setPositionState` ราย timeupdate; feature-detect (ไม่มี navigator.mediaSession →
    no-op)

## Test

- mediaSession unit (mock navigator.mediaSession): metadata ถูกตั้ง, handlers เรียก
  engine, no-op เมื่อไม่รองรับ; PlayerBar shuffle; NowPlaying open/close

## Evidence (2026-09-21)

- PlayerBar: +ปุ่ม shuffle (optimistic + PATCH /player/shuffle + getState mirror) + ปุ่ม
  ขยาย + responsive (ซ่อน seek/volume/repeat บนจอแคบ)
- NowPlayingView fullscreen (artwork/seek/volume/controls) + useUiStore
- mediaSession.ts: initMediaSession (play/pause/prev/next/seekto/seek±10s handlers),
  metadata+artwork ตาม track, playbackState mirror, positionState จาก progress store
  (subscribe — ไม่วนกลับเข้า audioEngine กัน circular import); feature-detect no-op
- mediaSession.test 4 cases เขียว (fake session inject, handlers → engine calls,
  positionState ตาม progress)
