/**
 * LikeService + HistoryService unit tests — api.md §8/§9 semantics (hermetic)
 * like: idempotent + emit LIKES_CHANGED เฉพาะเมื่อ state เปลี่ยน · unlike เช่นเดียวกัน
 * history: record clamp msPlayed [0,duration] + fail-soft · list cursor validation
 */
import { describe, expect, it } from "vitest";
import { createLikeService, type LikeRepos } from "./LikeService.js";
import { createHistoryService, type HistoryRepos } from "./HistoryService.js";
import { LibraryError } from "./LibraryError.js";
import type { RealtimeEventName } from "@musicplayer/shared";

const USER = "user-1";
const TRACK = "00000000-0000-4000-8000-000000000001";

function trackDto(id: string) {
  return {
    id,
    title: `T ${id}`,
    artist: "A",
    album: null,
    durationMs: 180_000,
    isStream: false,
    isSeekable: true,
    artworkUrl: null,
    sourceName: "youtube",
    isLiked: false,
  };
}

function makeLikeRepos() {
  const liked = new Map<string, Date>();
  const tracks = new Set<string>([
    TRACK,
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
    "00000000-0000-4000-8000-000000000004",
  ]);
  const emits: Array<{ userId: string; event: RealtimeEventName; payload: unknown }> =
    [];
  const repos: LikeRepos = {
    async likeTrackRow(userId, trackId) {
      const existing = liked.get(`${userId}:${trackId}`);
      if (existing) return { likedAt: existing, alreadyLiked: true };
      const likedAt = new Date();
      liked.set(`${userId}:${trackId}`, likedAt);
      return { likedAt, alreadyLiked: false };
    },
    async unlikeTrackRow(userId, trackId) {
      return liked.delete(`${userId}:${trackId}`);
    },
    async listLikedTracks(userId, options) {
      return [...liked.entries()]
        .filter(([key]) => key.startsWith(`${userId}:`))
        .map(([key, likedAt]) => ({ key, likedAt }))
        .filter((row) => !options.cursor || row.likedAt < options.cursor)
        .sort((a, b) => b.likedAt.getTime() - a.likedAt.getTime())
        .slice(0, options.limit)
        .map((row) => ({
          track: { ...trackDto(row.key.split(":")[1]!), isLiked: true },
          likedAt: row.likedAt.toISOString(),
        }));
    },
    async likedTrackIds(userId, trackIds) {
      return new Set(trackIds.filter((id) => liked.has(`${userId}:${id}`)));
    },
    async trackExists(trackId) {
      return tracks.has(trackId);
    },
  };
  const broadcaster = {
    emitToUser: (userId: string, event: RealtimeEventName, payload: unknown) => {
      emits.push({ userId, event, payload });
    },
    emitAll: () => undefined,
  } as never;
  return { repos, emits, service: createLikeService(repos, broadcaster) };
}

describe("LikeService", () => {
  it("like — ต้องมี track จริง (404) + กดซ้ำไม่ emit ซ้ำ (api.md #35 idempotent)", async () => {
    const { service, emits } = makeLikeRepos();
    await expect(service.like(USER, "ghost")).rejects.toMatchObject({
      code: "TRACK_NOT_FOUND",
    });
    const first = await service.like(USER, TRACK);
    expect(first).toEqual({ trackId: TRACK, liked: true });
    expect(emits).toHaveLength(1);
    expect(emits[0]!.event).toBe("LIKES_CHANGED");
    expect(emits[0]!.payload).toEqual({ trackId: TRACK, liked: true });

    const again = await service.like(USER, TRACK);
    expect(again.liked).toBe(true);
    expect(emits).toHaveLength(1); // ไม่มี event ใหม่ — state ไม่เปลี่ยน
  });

  it("unlike — ไม่มีอยู่ก็ 200 liked:false และไม่ emit (api.md #36 idempotent)", async () => {
    const { service, emits } = makeLikeRepos();
    const none = await service.unlike(USER, TRACK);
    expect(none).toEqual({ trackId: TRACK, liked: false });
    expect(emits).toHaveLength(0);
    await service.like(USER, TRACK);
    const removed = await service.unlike(USER, TRACK);
    expect(removed.liked).toBe(false);
    expect(emits).toHaveLength(2);
    expect(emits[1]!.payload).toEqual({ trackId: TRACK, liked: false });
  });

  it("list — เรียงใหม่→เก่า + nextCursor เมื่อครบ limit (api.md #34)", async () => {
    const { service } = makeLikeRepos();
    for (const offset of [1, 2, 3]) {
      await service.like(USER, `00000000-0000-4000-8000-00000000000${offset}`);
      // กัน likedAt ชนกันใน ms เดียว (sort เสี่ยงสลับ)
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const page1 = await service.list(USER, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.items[0]!.track.isLiked).toBe(true);
    const page2 = await service.list(USER, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });

  it("list — cursor ไม่ใช่ ISO → VALIDATION_ERROR", async () => {
    const { service } = makeLikeRepos();
    await expect(service.list(USER, { cursor: "junk" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("decorateTracks — เติม isLiked ตามชุดที่ user like", async () => {
    const { service } = makeLikeRepos();
    await service.like(USER, TRACK);
    const other = "00000000-0000-4000-8000-000000000002";
    const got = await service.decorateTracks(USER, [trackDto(TRACK), trackDto(other)]);
    expect(got.map((t) => t.isLiked)).toEqual([true, false]);
  });
});

function makeHistoryRepos() {
  const entries: Array<{
    userId: string;
    trackId: string;
    msPlayed: number;
    completed: boolean;
    skipped: boolean;
    playedAt: Date;
  }> = [];
  let failing = false;
  const repos: HistoryRepos = {
    async insertHistoryEntry(userId, entry) {
      if (failing) throw new Error("db down");
      entries.push({ userId, ...entry, playedAt: new Date() });
    },
    async listHistory(userId, options) {
      return entries
        .filter((e) => e.userId === userId)
        .filter((e) => !options.before || e.playedAt < options.before)
        .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime())
        .slice(0, options.limit)
        .map((e) => ({
          id: `h${entries.indexOf(e)}`,
          track: { ...trackDto(e.trackId), isLiked: false },
          playedAt: e.playedAt.toISOString(),
          msPlayed: e.msPlayed,
          completed: e.completed,
          skipped: e.skipped,
        }));
    },
  };
  return { entries, setFailing: (v: boolean) => (failing = v), repos };
}

describe("HistoryService", () => {
  const track = trackDto(TRACK);

  it("record — completed เก็บ msPlayed เต็ม duration (clamp)", async () => {
    const { entries, repos } = makeHistoryRepos();
    const service = createHistoryService(repos);
    await service.record(USER, {
      track,
      positionMs: 1_000_000,
      reason: "completed",
    });
    expect(entries[0]).toMatchObject({
      trackId: TRACK,
      msPlayed: 180_000,
      completed: true,
      skipped: false,
    });
  });

  it("record — skip เก็บ position จริง + clamp ที่ duration เสมอ (เกณฑ์ 30 s วัดจาก msPlayed)", async () => {
    const { entries, repos } = makeHistoryRepos();
    const service = createHistoryService(repos);
    await service.record(USER, { track, positionMs: 31_000, reason: "skip" });
    await service.record(USER, { track, positionMs: 5_000, reason: "skip" });
    expect(entries.map((e) => e.msPlayed)).toEqual([31_000, 5_000]);
    expect(entries.every((e) => e.skipped && !e.completed)).toBe(true);
  });

  it("record — fail-soft: DB พังไม่ throw กลับไปทำ playback พังตาม", async () => {
    const { repos, setFailing } = makeHistoryRepos();
    const service = createHistoryService(repos);
    setFailing(true);
    await expect(
      service.record(USER, { track, positionMs: 1_000, reason: "skip" }),
    ).resolves.toBeUndefined();
  });

  it("list — before ไม่ใช่ ISO → VALIDATION_ERROR", async () => {
    const { repos } = makeHistoryRepos();
    const service = createHistoryService(repos);
    await expect(service.list(USER, { before: "junk" })).rejects.toBeInstanceOf(
      LibraryError,
    );
  });
});
