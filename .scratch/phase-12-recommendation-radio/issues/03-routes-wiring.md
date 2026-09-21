# 03 Routes + wiring

Status: resolved

- recommendation.routes.ts: GET /recommendations (default 20, clamp 50, fail-soft 200 []),
  POST /radio/start (400 body/404 seed), POST /radio/extend (409 NO_RADIO)
- queue.routes.ts: POST /queue/tracks รับ radioSeedTrackId
- app.ts: register recommendationRoutes (inject deps.recommendation ให้ contract test),
  recommend adapter ส่ง boostArtists, provider log → app.log.warn
- contract tests: recommendation.contract.test.ts (9) + queue radioSeedTrackId (2)
