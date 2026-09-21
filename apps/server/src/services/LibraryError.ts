/**
 * LibraryError — error กลางของ Phase 10 (playlists/likes/history)
 * code map ตรง api.md §7–§9 (แปลงเป็น HTTP ผ่าน ERROR_STATUS ที่ routes)
 */
export class LibraryError extends Error {
  constructor(
    readonly code:
      "NAME_TAKEN" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" | "TRACK_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "LibraryError";
  }
}
