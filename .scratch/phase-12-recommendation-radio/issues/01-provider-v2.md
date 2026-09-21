# 01 Provider v2 — candidate/scoring/genre constraint/getHomeFeed

Status: resolved

- provider.ts: interface เพิ่ม getHomeFeed + RadioSeed.boostArtists (§6 adaptive)
- recommendation.repo.ts: findSameGenreTracks (normalized SQL + GIN), findSameAlbumTracks,
  findRecentlyPlayedTracks/TrackIds, findSkippedTrackIds, findLastCompletedTracks; ทุก query
  คืน RadioCandidate (TrackDTO + genres)
- ruleBased.ts: candidate pool §2.1 → genre hard filter §2.1.1 → scoring §2.2
  (genre+6/liked+5/top+4/artist+4/album+3/recent+3, recencyBoost 0.5, artist ซ้ำ ≥3 −4,
  boost +2, jitter ±1) → weighted random top-10; คลาย filter ตาม §9 (recent/skipped ก่อน,
  genre เฉพาะผลว่าง) · getHomeFeed (seedGenres cap 5, cold start → [])
- unit tests 19/19 (rng inject deterministic)
