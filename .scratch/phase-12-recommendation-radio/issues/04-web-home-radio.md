# 04 Web — home feed + radio UX

Status: resolved

- api: recommendationsApi.list / radioApi.start|extend
- audioEngine.startRadio: POST /radio/start → set queue + state PLAYING + radio:true local
  (WS event อาจช้ากว่า REST) → startStream(seed) — ห้าม /player/play ซ้ำ
- HomePage: section "แนะนำสำหรับคุณ" (rows ▶ เล่น / 📻 radio) + empty state cold start §7
- PlayerBar: badge 📻 (player-radio) เมื่อ radio active · applyRemotePlayerState แนบ radio
- i18n home.recommended*/recPlay/recRadio + player.radioOn (th/en) · tests 3 ใหม่ (web 72)
