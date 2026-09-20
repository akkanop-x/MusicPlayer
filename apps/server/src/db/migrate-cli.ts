import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadEnv } from "../config/env.js";
import { createDb } from "./client.js";
import { migrationsFolder } from "./migrationsFolder.js";

/** รัน migration ด้วยมือ (เทียบเท่ากับ `drizzle-kit migrate`) — ปกติ boot รันให้อัตโนมัติ */
const env = loadEnv();
const db = createDb(env.DATABASE_URL);
await migrate(db, { migrationsFolder });
console.log("Migrations applied");
process.exit(0);
