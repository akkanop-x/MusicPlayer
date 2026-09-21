# 02 PlayerService radio

Status: resolved

- UserPlayer.radio { seedTrackId, playedArtists } · PlayerError NO_RADIO · PlayerStateDTO.radio
- startRadio: แทน queue ทั้งก้อน (current = seed, upcoming 20) · extendRadio: +10
  (exclude ครอบ session, boostArtists จาก playedArtists)
- radio active → refill/prefetch ทำงานแม้ autoplay toggle ปิด (seed = ของสถานี)
- play()/clear(all) ล้าง radio · reportTrackEnded จด artist (§6 adaptive)
- contract tests 7 เพิ่ม (player.contract.test.ts 29/29)
