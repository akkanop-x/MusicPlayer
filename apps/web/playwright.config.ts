/**
 * Playwright E2E — testing.md §3.6 (DoD Phase 9): journeys บน chromium กับ stack ครบ
 * ใน docker compose (web :8080) — run local เท่านั้น (E2E เข้า CI ตอน Phase 13)
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 1, // journeys แชร์ player state ของ server — ต้องเรียงลำดับ
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
