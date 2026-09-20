import { users, userSettings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

export async function findUserByEmail(
  db: Db,
  email: string,
): Promise<(PublicUser & { passwordHash: string }) | undefined> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row;
}

export async function findUserById(
  db: Db,
  id: string,
): Promise<PublicUser | undefined> {
  const [row] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row;
}

/** สร้าง user + user_settings เริ่มต้น (users ||--|| user_settings) */
export async function createUser(
  db: Db,
  input: { email: string; passwordHash: string; displayName: string },
): Promise<PublicUser> {
  const [row] = await db
    .insert(users)
    .values({
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
    })
    .returning({ id: users.id, email: users.email, displayName: users.displayName });
  if (!row) throw new Error("createUser: no row returned");
  await db.insert(userSettings).values({ userId: row.id });
  return row;
}
