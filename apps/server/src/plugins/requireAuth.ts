import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyJwt, JwtError } from "../services/auth/jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string };
  }
}

/**
 * guard สำหรับ endpoint ที่ใช้ Bearer access token (api.md: ทุก endpoint เว้นแต่ระบุ Public)
 * ต้องเป็น async preHandler — fastify hook แบบ sync ต้องเรียก done() เอง
 */
export function requireAuth(jwtSecret: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return void reply.status(401).send(apiUnauthenticated());
    }
    try {
      const payload = verifyJwt(header.slice("Bearer ".length), jwtSecret);
      request.user = { id: payload.sub };
    } catch (error) {
      request.log.debug({ err: error }, "auth failed");
      if (!(error instanceof JwtError)) throw error;
      return void reply.status(401).send(apiUnauthenticated());
    }
  };
}

export function apiUnauthenticated(): { error: { code: string; message: string } } {
  return { error: { code: "UNAUTHENTICATED", message: "Authentication required" } };
}
