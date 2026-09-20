import { z } from "zod";

/**
 * Env ทั้งหมดผ่าน zod ตอน boot (fail-fast) — backend.md §5
 * secret ห้าม commit: ค่าจริงอยู่ใน .env (dev) / secrets manager (prod)
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().optional(),
  LAVALINK_URL: z.string().min(1),
  LAVALINK_PASSWORD: z.string().min(1),
  RESOLVER_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  REFRESH_SECRET: z.string().min(32),
  /** security.md §8.2 — default "*.googlevideo.com"; คั่นด้วย comma ได้ */
  SSRF_HOST_ALLOWLIST: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${missing}`);
  }
  return parsed.data;
}
