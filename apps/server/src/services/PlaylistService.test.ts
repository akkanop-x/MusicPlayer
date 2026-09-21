/**
 * PlaylistService unit tests — api.md §7 semantics (hermetic: in-memory fake repos)
 * ครอบ: create/NAME_TAKEN, ownership (403/404), addTracks (append/แทรก position/track หาย),
 * removeTracks (itemIds ไม่ตรง), reorderTracks (validation + ผลลัพธ์ลำดับ), getTrackIds
 */
import { describe, expect, it } from "vitest";
import {
  createPlaylistService,
  type PlaylistItem,
  type PlaylistRepos,
} from "./PlaylistService.js";
import type { PlaylistDTO, TrackDTO } from "@musicplayer/shared";

const USER = "user-1";
const OTHER = "user-2";

function track(id: string): TrackDTO {
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

/** fake repos — semantics ตรง playlist.repo (position ต่อเนื่อง, reorder ทับ, soft delete) */
function makeRepos() {
  interface Row {
    id: string;
    userId: string;
    name: string;
    description: string | null;
    isDeleted: boolean;
    updatedAt: Date;
  }
  const rows: Row[] = [];
  const items = new Map<string, Array<{ id: string; track: TrackDTO }>>();
  const tracksTable = new Map<string, TrackDTO>();
  let seq = 0;
  const uid = () => `p${++seq}`;
  const iid = () => `i${++seq}`;

  const repos: PlaylistRepos = {
    async listPlaylists(userId) {
      return rows
        .filter((r) => r.userId === userId && !r.isDeleted)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((r): PlaylistDTO => ({
          id: r.id,
          name: r.name,
          description: r.description,
          coverUrl: null,
          trackCount: (items.get(r.id) ?? []).length,
          updatedAt: r.updatedAt.toISOString(),
        }));
    },
    async findPlaylistRow(id) {
      const row = rows.find((r) => r.id === id && !r.isDeleted);
      return row ? { id: row.id, userId: row.userId, name: row.name } : null;
    },
    async findPlaylistByName(userId, name) {
      const row = rows.find(
        (r) => r.userId === userId && r.name === name && !r.isDeleted,
      );
      return row ? { id: row.id } : null;
    },
    async createPlaylist(userId, input) {
      const row: Row = {
        id: uid(),
        userId,
        name: input.name,
        description: input.description,
        isDeleted: false,
        updatedAt: new Date(),
      };
      rows.push(row);
      items.set(row.id, []);
      return (await repos.listPlaylists(userId))[0]!;
    },
    async updatePlaylist(id, patch) {
      const row = rows.find((r) => r.id === id)!;
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.description !== undefined) row.description = patch.description;
      row.updatedAt = new Date();
    },
    async deletePlaylist(id) {
      const row = rows.find((r) => r.id === id)!;
      row.isDeleted = true;
    },
    async listPlaylistItems(playlistId): Promise<PlaylistItem[]> {
      return (items.get(playlistId) ?? []).map((item) => ({ ...item }));
    },
    async appendPlaylistTracks(playlistId, trackIds) {
      const list = items.get(playlistId) ?? [];
      for (const trackId of trackIds) {
        const t = tracksTable.get(trackId);
        if (!t) throw new Error("FK violation (test fake)");
        list.push({ id: iid(), track: t });
      }
      items.set(playlistId, list);
    },
    async removePlaylistItems(playlistId, itemIds) {
      items.set(
        playlistId,
        (items.get(playlistId) ?? []).filter((item) => !itemIds.includes(item.id)),
      );
    },
    async reorderPlaylistItems(playlistId, orderedItemIds) {
      const byId = new Map((items.get(playlistId) ?? []).map((i) => [i.id, i]));
      items.set(
        playlistId,
        orderedItemIds.map((id) => byId.get(id)!),
      );
    },
    async existingTrackIds(trackIds) {
      return new Set(trackIds.filter((id) => tracksTable.has(id)));
    },
  };
  return {
    repos,
    addTrack: (id: string) => tracksTable.set(id, track(id)),
    service: createPlaylistService(repos),
  };
}

describe("PlaylistService", () => {
  it("create — คืน DTO (trackCount 0) และ NAME_TAKEN เมื่อชื่อซ้ำ (api.md #27)", async () => {
    const { service } = makeRepos();
    const created = await service.create(USER, { name: "  My Mix  " });
    expect(created.name).toBe("My Mix");
    expect(created.trackCount).toBe(0);
    await expect(service.create(USER, { name: "My Mix" })).rejects.toMatchObject({
      code: "NAME_TAKEN",
    });
  });

  it("create — name ว่าง/เกิน 200 → VALIDATION_ERROR", async () => {
    const { service } = makeRepos();
    await expect(service.create(USER, { name: "" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(service.create(USER, { name: "x".repeat(201) })).rejects.toMatchObject(
      { code: "VALIDATION_ERROR" },
    );
  });

  it("get — playlist ของคนอื่น → FORBIDDEN, ไม่มี → NOT_FOUND (api.md #28)", async () => {
    const { service } = makeRepos();
    const created = await service.create(USER, { name: "Mix" });
    await expect(service.get(OTHER, created.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      service.get(USER, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("addTracks — append ตามลำดับ + แทรก position กลาง list (api.md #31)", async () => {
    const { service, addTrack } = makeRepos();
    for (const id of ["t1", "t2", "t3"]) addTrack(id);
    const created = await service.create(USER, { name: "Mix" });
    await service.addTracks(USER, created.id, ["t1", "t2"]);
    await service.addTracks(USER, created.id, ["t3"], 1);
    const got = await service.get(USER, created.id);
    expect(got.tracks?.map((t) => t.id)).toEqual(["t1", "t3", "t2"]);
    expect(got.itemIds).toHaveLength(3); // itemIds สัมพันธ์ตามลำดับกับ tracks
    expect(got.trackCount).toBe(3);
  });

  it("addTracks — track ไม่มีในระบบ → TRACK_NOT_FOUND (404)", async () => {
    const { service, addTrack } = makeRepos();
    addTrack("t1");
    const created = await service.create(USER, { name: "Mix" });
    await expect(
      service.addTracks(USER, created.id, ["t1", "ghost"]),
    ).rejects.toMatchObject({ code: "TRACK_NOT_FOUND" });
  });

  it("removeTracks — itemIds ที่ไม่อยู่ใน playlist → VALIDATION_ERROR (api.md #32)", async () => {
    const { service, addTrack } = makeRepos();
    addTrack("t1");
    const created = await service.create(USER, { name: "Mix" });
    await service.addTracks(USER, created.id, ["t1"]);
    const got = await service.get(USER, created.id);
    const itemId = got.itemIds![0]!;
    await expect(
      service.removeTracks(USER, created.id, [itemId, "i-ghost"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const after = await service.removeTracks(USER, created.id, [itemId]);
    expect(after.trackCount).toBe(0);
  });

  it("reorderTracks — ต้องครบทุก item พอดี แล้วลำดับเปลี่ยนตาม (api.md #33)", async () => {
    const { service, addTrack } = makeRepos();
    for (const id of ["t1", "t2", "t3"]) addTrack(id);
    const created = await service.create(USER, { name: "Mix" });
    await service.addTracks(USER, created.id, ["t1", "t2", "t3"]);
    const got = await service.get(USER, created.id);
    const ids = got.itemIds!;
    // ขาด item / ซ้ำ → 400
    await expect(
      service.reorderTracks(USER, created.id, ids.slice(1)),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.reorderTracks(USER, created.id, [ids[0]!, ids[1]!, ids[1]!]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await service.reorderTracks(USER, created.id, [ids[2]!, ids[0]!, ids[1]!]);
    const after = await service.get(USER, created.id);
    expect(after.tracks?.map((t) => t.id)).toEqual(["t3", "t1", "t2"]);
  });

  it("getTrackIds — คืน trackId ตามลำดับ (ใช้โดย POST /queue/tracks playlistId)", async () => {
    const { service, addTrack } = makeRepos();
    for (const id of ["t1", "t2"]) addTrack(id);
    const created = await service.create(USER, { name: "Mix" });
    await service.addTracks(USER, created.id, ["t1", "t2"]);
    expect(await service.getTrackIds(USER, created.id)).toEqual(["t1", "t2"]);
  });

  it("delete — soft delete แล้ว get ไม่เจอ (api.md #30)", async () => {
    const { service } = makeRepos();
    const created = await service.create(USER, { name: "Mix" });
    await service.remove(USER, created.id);
    await expect(service.get(USER, created.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
