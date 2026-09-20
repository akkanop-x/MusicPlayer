import {
  apiError,
  ERROR_STATUS,
  type ApiErrorBody,
  type ErrorCode,
} from "@musicplayer/shared";

/** base ของ error จาก LavalinkClient — route แปลงเป็น error shape กลาง */
export class LavalinkError extends Error {
  readonly code: ErrorCode = "UPSTREAM_UNAVAILABLE";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LavalinkError";
  }

  toBody(): ApiErrorBody {
    return apiError(this.code, this.message);
  }
}

/** Lavalink ล่ม/timeout/breaker open */
export class LavalinkUnavailableError extends LavalinkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LavalinkUnavailableError";
  }
}

/** Lavalink ตอบกลับมาแต่ผิดปกติ (4xx = config/usage, 5xx = upstream fault) */
export class LavalinkRequestError extends LavalinkError {
  readonly status: number;
  readonly body?: string;

  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = "LavalinkRequestError";
    this.status = status;
    this.body = body;
  }
}

/** loadType=error จาก loadtracks (lavalink.md §8 — map เป็น 503 ฝั่ง route) */
export class LavalinkLoadError extends LavalinkError {
  constructor(
    message: string,
    readonly severity: string,
  ) {
    super(message);
    this.name = "LavalinkLoadError";
  }
}

export const LAVALINK_ERROR_STATUS = ERROR_STATUS.UPSTREAM_UNAVAILABLE;
