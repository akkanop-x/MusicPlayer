import { apiError, ERROR_STATUS, type ApiErrorBody } from "@musicplayer/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { REFRESH_COOKIE_NAME, type AuthError } from "../services/auth/AuthService.js";
import { requireAuth } from "../plugins/requireAuth.js";

const registerSchema = z.object({
  email: z.string().trim().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().trim().max(255),
  password: z.string().min(1).max(128),
});

export interface AuthRoutesDeps {
  register(input: { email: string; password: string; displayName: string }): Promise<{
    accessToken: string;
    refreshToken: string;
  }>;
  login(input: { email: string; password: string }): Promise<{
    accessToken: string;
    refreshToken: string;
  }>;
  refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>;
  logout(refreshToken: string | undefined): Promise<void>;
  me(userId: string): Promise<{ id: string; email: string; displayName: string }>;
  jwtSecret: string;
}

/** คุณสมบัติของ refresh cookie — security.md §8.6 (cookie เดียวกันใช้ยืนยัน /stream) */
export const REFRESH_COOKIE_OPTIONS = {
  path: "/api/v1",
  httpOnly: true,
  sameSite: "strict",
  // dev รันผ่าน http (localhost / reverse proxy ภายใน) — เปิด Secure ตอน deploy ผ่าน https
  secure: process.env.COOKIE_SECURE === "true",
} as const;

function toAuthErrorBody(error: AuthError): ApiErrorBody {
  return apiError(error.code, error.message);
}

export const authRoutes: FastifyPluginAsync<AuthRoutesDeps> = async (app, deps) => {
  app.post("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(ERROR_STATUS.VALIDATION_ERROR)
        .send(
          apiError(
            "VALIDATION_ERROR",
            "Invalid registration data",
            z.flattenError(parsed.error),
          ),
        );
    }
    try {
      const tokens = await deps.register(parsed.data);
      void reply.setCookie(
        REFRESH_COOKIE_NAME,
        tokens.refreshToken,
        REFRESH_COOKIE_OPTIONS,
      );
      return reply.send({ accessToken: tokens.accessToken });
    } catch (error) {
      return handleAuthError(reply, error);
    }
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(ERROR_STATUS.VALIDATION_ERROR)
        .send(
          apiError(
            "VALIDATION_ERROR",
            "Invalid login data",
            z.flattenError(parsed.error),
          ),
        );
    }
    try {
      const tokens = await deps.login(parsed.data);
      void reply.setCookie(
        REFRESH_COOKIE_NAME,
        tokens.refreshToken,
        REFRESH_COOKIE_OPTIONS,
      );
      return reply.send({ accessToken: tokens.accessToken });
    } catch (error) {
      return handleAuthError(reply, error);
    }
  });

  app.post("/auth/refresh", async (request, reply) => {
    const refreshToken = request.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      return reply
        .status(ERROR_STATUS.UNAUTHENTICATED)
        .send(apiError("UNAUTHENTICATED", "Missing refresh token"));
    }
    try {
      const tokens = await deps.refresh(refreshToken);
      void reply.setCookie(
        REFRESH_COOKIE_NAME,
        tokens.refreshToken,
        REFRESH_COOKIE_OPTIONS,
      );
      return reply.send({ accessToken: tokens.accessToken });
    } catch (error) {
      return handleAuthError(reply, error);
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    await deps.logout(request.cookies?.[REFRESH_COOKIE_NAME]);
    void reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_OPTIONS.path });
    return reply.status(204).send();
  });

  app.get(
    "/me",
    { preHandler: requireAuth(deps.jwtSecret) },
    async (request, reply) => {
      try {
        return await deps.me(request.user!.id);
      } catch (error) {
        return handleAuthError(reply, error);
      }
    },
  );
};

function handleAuthError(
  reply: {
    status(code: number): { send(body: ApiErrorBody): unknown };
  },
  error: unknown,
): unknown {
  const authError = error as AuthError;
  if (authError?.name === "AuthError") {
    return reply.status(ERROR_STATUS[authError.code]).send(toAuthErrorBody(authError));
  }
  throw error;
}
