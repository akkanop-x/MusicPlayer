# 04 HistoryService + routes + PlayerService callback

Status: resolved

- PlayerDeps.onPlaybackEnded(userId, {track, positionMs, reason:"completed"|"skip"})
- clamp msPlayed [0,duration]; GET /history ?limit&before
- POST /queue/tracks รับ { playlistId } (api.md #20) ผ่าน dep getPlaylistTrackIds
  Evidence: —
  Lessons: —
