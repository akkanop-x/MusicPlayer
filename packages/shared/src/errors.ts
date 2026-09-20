/**
 * โครงสร้าง error เดียวของทั้งระบบ (backend.md §4):
 * `{ error: { code, message, details? } }` — client ทั้ง REST และ WS อ่านจาก shape นี้เท่านั้น
 * ห้ามส่ง stack trace หรือรายละเอียด infra ออกนอก server
 */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "TRACK_UNPLAYABLE",
  "EMAIL_TAKEN",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export function apiError(
  code: ErrorCode,
  message: string,
  details?: unknown,
): ApiErrorBody {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

/** สถานะ HTTP มาตรฐานของแต่ละ error code (ตัดสินใจที่ application layer ตาม backend.md) */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 503,
  TRACK_UNPLAYABLE: 422,
  EMAIL_TAKEN: 409,
  INTERNAL: 500,
};
