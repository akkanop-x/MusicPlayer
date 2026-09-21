# 03 LikeService + like.routes + LIKES_CHANGED

Status: resolved

- PUT/DELETE /tracks/:id/like idempotent; GET /likes cursor
- decorateTracks(userId, tracks) → search routes + tracks routes
- emit LIKES_CHANGED ผ่าน Broadcaster (RealtimeHub แนบ version)
  Evidence: —
  Lessons: —
