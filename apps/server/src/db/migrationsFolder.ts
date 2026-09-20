import path from "node:path";
import { fileURLToPath } from "node:url";

/** โฟลเดอร์ migrations ของ drizzle-kit — resolve จากตำแหน่งไฟล์ ไม่ขึ้นกับ cwd */
export const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "drizzle",
);
