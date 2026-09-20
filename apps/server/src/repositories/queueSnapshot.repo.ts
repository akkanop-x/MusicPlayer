/**
 * queue snapshot repo — queue.md §8: ทุก mutation → queue_snapshots (current/position/
 * shuffle/repeat) + queue_items (upcoming + history, cap 100, ใหม่→เก่า)
 * เขียนทับทั้งชุดทุกครั้ง (ง่ายและถูกต้องกว่า delta — 1–5 concurrent users)
 */
import { and, asc, eq } from "drizzle-orm";
import type { RepeatMode } from "@musicplayer/shared";
import type { Db } from "../db/client.js";
import { queueItems, queueSnapshots } from "../db/schema.js";
import type { QueueSnapshot } from "../services/PlayerService.js";

export async function saveQueueSnapshot(
  db: Db,
  userId: string,
  snap: QueueSnapshot,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(queueSnapshots)
      .values({
        userId,
        currentTrackId: snap.currentTrackId,
        positionMs: snap.positionMs,
        shuffleOn: snap.shuffleOn,
        repeatMode: snap.repeatMode,
      })
      .onConflictDoUpdate({
        target: queueSnapshots.userId,
        set: {
          currentTrackId: snap.currentTrackId,
          positionMs: snap.positionMs,
          shuffleOn: snap.shuffleOn,
          repeatMode: snap.repeatMode,
          updatedAt: new Date(),
        },
      });

    await tx.delete(queueItems).where(eq(queueItems.userId, userId));
    const rows = [
      ...snap.upcoming.map((item, position) => ({
        userId,
        kind: "upc" as const,
        id: item.id,
        trackId: item.trackId,
        position,
        originalPosition: item.originalPosition,
      })),
      ...snap.history.map((item, position) => ({
        userId,
        kind: "hist" as const,
        id: item.id,
        trackId: item.trackId,
        position, // 0 = เล่นล่าสุด (ใหม่→เก่า)
        originalPosition: item.originalPosition,
      })),
    ];
    if (rows.length > 0) await tx.insert(queueItems).values(rows);
  });
}

export async function loadQueueSnapshot(
  db: Db,
  userId: string,
): Promise<QueueSnapshot | null> {
  const [snap] = await db
    .select()
    .from(queueSnapshots)
    .where(eq(queueSnapshots.userId, userId))
    .limit(1);
  if (!snap) return null;

  const items = await db
    .select({
      id: queueItems.id,
      kind: queueItems.kind,
      trackId: queueItems.trackId,
      position: queueItems.position,
      originalPosition: queueItems.originalPosition,
    })
    .from(queueItems)
    .where(eq(queueItems.userId, userId))
    .orderBy(asc(queueItems.position));

  const ofKind = (kind: "upc" | "hist") =>
    items
      .filter((i) => i.kind === kind)
      .map((i) => ({
        id: i.id,
        trackId: i.trackId,
        originalPosition: i.originalPosition,
      }));

  return {
    currentTrackId: snap.currentTrackId,
    positionMs: snap.positionMs,
    shuffleOn: snap.shuffleOn,
    repeatMode: snap.repeatMode as RepeatMode,
    upcoming: ofKind("upc"),
    history: ofKind("hist"),
  };
}

/** ใช้ใน test/ops — ล้าง snapshot ของ user */
export async function deleteQueueSnapshot(db: Db, userId: string): Promise<void> {
  await db.delete(queueItems).where(and(eq(queueItems.userId, userId)));
  await db.delete(queueSnapshots).where(eq(queueSnapshots.userId, userId));
}
