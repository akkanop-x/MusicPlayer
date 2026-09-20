import { apiError, ERROR_STATUS } from "@musicplayer/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { PassThrough } from "node:stream";
import { REFRESH_COOKIE_NAME } from "../services/auth/AuthService.js";
import { StreamError } from "../services/StreamService.js";
import { StreamGuard } from "../security/streamGuard.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StreamRoutesDeps {
  /** ตรวจ refresh cookie แบบ read-only (security.md §8.6) → userId | null */
  validateSession(refreshToken: string): Promise<string | null>;
  openStream(
    trackId: string,
    rangeHeader?: string,
  ): Promise<{
    statusCode: number;
    headers: Record<string, string>;
    stream: PassThrough;
  }>;
}

/** pipe stream จริงออก raw response — response นี้ไม่ใช่ JSON */
function pipeToRaw(
  reply: FastifyReply,
  request: FastifyRequest,
  opened: {
    statusCode: number;
    headers: Record<string, string>;
    stream: PassThrough;
  },
): void {
  reply.hijack();
  reply.raw.writeHead(opened.statusCode, opened.headers);
  opened.stream.pipe(reply.raw);
  opened.stream.on("error", () => {
    reply.raw.destroy();
  });
  // client ปิด connection (pause/seek/ปิดแท็บ) → หยุดดึงจาก upstream ทันที
  request.raw.on("close", () => {
    opened.stream.destroy();
  });
}

function toStreamError(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof StreamError) {
    const status = ERROR_STATUS[error.code];
    return reply.status(status).send(apiError(error.code, error.message));
  }
  throw error;
}

export const streamRoutes: FastifyPluginAsync<StreamRoutesDeps> = async (app, deps) => {
  const guard = new StreamGuard();

  app.get("/stream/:trackId", async (request, reply) => {
    // auth พิเศษของ endpoint นี้: session cookie (httpOnly) — browser แนบเองเมื่อ same-origin
    const rawCookie = request.cookies?.[REFRESH_COOKIE_NAME];
    const userId = rawCookie ? await deps.validateSession(rawCookie) : null;
    if (!userId) {
      return reply
        .status(ERROR_STATUS.UNAUTHENTICATED)
        .send(apiError("UNAUTHENTICATED", "Authentication required"));
    }

    const { trackId } = request.params as { trackId: string };
    if (!UUID_RE.test(trackId)) {
      return reply
        .status(ERROR_STATUS.VALIDATION_ERROR)
        .send(apiError("VALIDATION_ERROR", "trackId must be a UUID"));
    }

    const acquired = guard.tryAcquire(userId);
    if (acquired === "rate-limited") {
      return reply
        .status(ERROR_STATUS.RATE_LIMITED)
        .send(apiError("RATE_LIMITED", "Too many stream requests"));
    }
    if (acquired === "too-many-streams") {
      return reply
        .status(ERROR_STATUS.RATE_LIMITED)
        .send(apiError("RATE_LIMITED", "Too many concurrent streams"));
    }

    try {
      const opened = await deps.openStream(trackId, request.headers.range);
      reply.raw.on("close", () => guard.release(userId));
      return pipeToRaw(reply, request, opened);
    } catch (error) {
      guard.release(userId);
      return toStreamError(reply, error);
    }
  });
};
