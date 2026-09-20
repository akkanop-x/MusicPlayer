import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    environment: "jsdom",
    // e2e/ เป็น Playwright specs (bun run e2e) — ห้ามให้ vitest เก็บ
    exclude: ["**/node_modules/**", "e2e/**"],
  },
});
