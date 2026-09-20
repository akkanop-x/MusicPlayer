import { migrate } from "drizzle-orm/node-postgres/migrator";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { migrationsFolder } from "./db/migrationsFolder.js";
import { seedSystemEqPresets } from "./repositories/eq.repo.js";

async function main(): Promise<void> {
  const env = loadEnv();

  // migration run อัตโนมัติก่อน listen — DoD ของ Phase 1
  const db = createDb(env.DATABASE_URL);
  await migrate(db, { migrationsFolder });
  // system EQ presets 7 อัน — idempotent (id คงที่, onConflictDoNothing — equalizer.md §4)
  await seedSystemEqPresets(db);

  const app = buildApp(env, { db });
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error("Fatal: server failed to start", error);
  process.exit(1);
});
