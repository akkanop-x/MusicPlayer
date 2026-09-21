# 02 PlaylistService + routes + contract tests

Status: resolved

- CRUD + add/remove/reorder tracks (UNIQUE position — rewrite positions ใน transaction)
- 409 NAME_TAKEN / 403 ไม่ใช่เจ้าของ / 404 / 400; name 1–200
- LibraryError → ERROR_STATUS map; AppDeps.library
  Evidence: —
  Lessons: —
