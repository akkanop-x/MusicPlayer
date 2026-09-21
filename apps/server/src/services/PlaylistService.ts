/**
 * PlaylistService — api.md §7 (endpoint 26–33)
 * DI แบบเดียวกับ PlayerService: รับชุด repo functions (playlist.repo) — test แทนที่ด้วย
 * in-memory fake ได้ (hermetic); logic ฝั่ง service = validation + ownership + ลำดับ
 */
import type { PlaylistDTO, TrackDTO } from "@musicplayer/shared";
import { LibraryError } from "./LibraryError.js";

/** row เว้น field infra — service ใช้แค่ ownership/ชื่อ */
export interface PlaylistRowLite {
  id: string;
  userId: string;
  name: string;
}

export interface PlaylistItem {
  /** id ของ playlist_tracks (itemIds ใน DELETE/ORDER) */
  id: string;
  track: TrackDTO;
}

export interface PlaylistRepos {
  listPlaylists(userId: string): Promise<PlaylistDTO[]>;
  findPlaylistRow(id: string): Promise<PlaylistRowLite | null>;
  findPlaylistByName(userId: string, name: string): Promise<{ id: string } | null>;
  createPlaylist(
    userId: string,
    input: { name: string; description: string | null },
  ): Promise<PlaylistDTO>;
  updatePlaylist(
    id: string,
    patch: { name?: string; description?: string | null },
  ): Promise<void>;
  deletePlaylist(id: string): Promise<void>;
  listPlaylistItems(playlistId: string, userId: string): Promise<PlaylistItem[]>;
  appendPlaylistTracks(playlistId: string, trackIds: string[]): Promise<void>;
  removePlaylistItems(playlistId: string, itemIds: string[]): Promise<void>;
  reorderPlaylistItems(playlistId: string, orderedItemIds: string[]): Promise<void>;
  existingTrackIds(trackIds: string[]): Promise<Set<string>>;
}

export interface PlaylistService {
  list(userId: string): Promise<{ playlists: PlaylistDTO[] }>;
  get(userId: string, id: string): Promise<PlaylistDTO>;
  create(
    userId: string,
    input: { name: string; description?: string | null },
  ): Promise<PlaylistDTO>;
  update(
    userId: string,
    id: string,
    patch: { name?: string; description?: string | null },
  ): Promise<PlaylistDTO>;
  remove(userId: string, id: string): Promise<void>;
  addTracks(
    userId: string,
    id: string,
    trackIds: string[],
    position?: number,
  ): Promise<PlaylistDTO>;
  removeTracks(userId: string, id: string, itemIds: string[]): Promise<PlaylistDTO>;
  reorderTracks(
    userId: string,
    id: string,
    orderedItemIds: string[],
  ): Promise<PlaylistDTO>;
  /** id เพลงเรียงตาม position — POST /queue/tracks {playlistId} (api.md #20) */
  getTrackIds(userId: string, id: string): Promise<string[]>;
}

export const PLAYLIST_NAME_MAX = 200;
const TRACKS_CAP = 500;

export function createPlaylistService(repos: PlaylistRepos): PlaylistService {
  /** meta จาก list ของ user (listPlaylists มี trackCount/updatedAt ครบ) */
  async function metaOf(userId: string, id: string): Promise<PlaylistDTO> {
    const playlists = await repos.listPlaylists(userId);
    const meta = playlists.find((p) => p.id === id);
    if (!meta) throw new LibraryError("NOT_FOUND", "playlist not found");
    return meta;
  }

  async function requireOwned(userId: string, id: string): Promise<PlaylistRowLite> {
    const row = await repos.findPlaylistRow(id);
    if (!row) throw new LibraryError("NOT_FOUND", "playlist not found");
    if (row.userId !== userId) {
      throw new LibraryError("FORBIDDEN", "not your playlist");
    }
    return row;
  }

  return {
    async list(userId) {
      return { playlists: await repos.listPlaylists(userId) };
    },

    async get(userId, id) {
      await requireOwned(userId, id);
      const meta = await metaOf(userId, id);
      const items = await repos.listPlaylistItems(id, userId);
      return {
        ...meta,
        tracks: items.map((item) => item.track),
        itemIds: items.map((item) => item.id),
      };
    },

    async create(userId, input) {
      const name = input.name.trim();
      if (name.length === 0 || name.length > PLAYLIST_NAME_MAX) {
        throw new LibraryError(
          "VALIDATION_ERROR",
          `name must be 1–${PLAYLIST_NAME_MAX} characters`,
        );
      }
      if (await repos.findPlaylistByName(userId, name)) {
        throw new LibraryError("NAME_TAKEN", `playlist "${name}" already exists`);
      }
      return repos.createPlaylist(userId, {
        name,
        description: input.description?.trim() || null,
      });
    },

    async update(userId, id, patch) {
      const row = await requireOwned(userId, id);
      const next: { name?: string; description?: string | null } = {};
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (name.length === 0 || name.length > PLAYLIST_NAME_MAX) {
          throw new LibraryError(
            "VALIDATION_ERROR",
            `name must be 1–${PLAYLIST_NAME_MAX} characters`,
          );
        }
        if (name !== row.name && (await repos.findPlaylistByName(userId, name))) {
          throw new LibraryError("NAME_TAKEN", `playlist "${name}" already exists`);
        }
        next.name = name;
      }
      if (patch.description !== undefined) {
        next.description = patch.description?.trim() || null;
      }
      await repos.updatePlaylist(id, next);
      return metaOf(userId, id);
    },

    async remove(userId, id) {
      await requireOwned(userId, id);
      await repos.deletePlaylist(id);
    },

    async addTracks(userId, id, trackIds, position) {
      await requireOwned(userId, id);
      if (trackIds.length === 0) {
        throw new LibraryError("VALIDATION_ERROR", "trackIds must not be empty");
      }
      if (trackIds.length > 50) {
        throw new LibraryError("VALIDATION_ERROR", "trackIds must be 1–50");
      }
      const existing = await repos.existingTrackIds(trackIds);
      const missing = trackIds.filter((trackId) => !existing.has(trackId));
      if (missing.length > 0) {
        throw new LibraryError("TRACK_NOT_FOUND", "some tracks do not exist");
      }
      const items = await repos.listPlaylistItems(id, userId);
      if (items.length + trackIds.length > TRACKS_CAP) {
        throw new LibraryError(
          "VALIDATION_ERROR",
          `playlist cap is ${TRACKS_CAP} tracks`,
        );
      }
      await repos.appendPlaylistTracks(id, trackIds);
      if (position !== undefined) {
        // แทรกกลาง list: append แล้วจัดลำดับใหม่ทั้งชุดให้ก้อนใหม่เข้าที่ position
        const appended = await repos.listPlaylistItems(id, userId);
        const newItems = appended.slice(items.length).map((item) => item.id);
        const oldItems = appended.slice(0, items.length).map((item) => item.id);
        const at = Math.min(Math.max(0, position), items.length);
        const order = [...oldItems.slice(0, at), ...newItems, ...oldItems.slice(at)];
        await repos.reorderPlaylistItems(id, order);
      }
      return metaOf(userId, id);
    },

    async removeTracks(userId, id, itemIds) {
      await requireOwned(userId, id);
      const items = await repos.listPlaylistItems(id, userId);
      const owned = new Set(items.map((item) => item.id));
      const unknown = itemIds.filter((itemId) => !owned.has(itemId));
      if (itemIds.length === 0 || unknown.length > 0) {
        throw new LibraryError("VALIDATION_ERROR", "unknown itemIds");
      }
      await repos.removePlaylistItems(id, itemIds);
      return metaOf(userId, id);
    },

    async reorderTracks(userId, id, orderedItemIds) {
      await requireOwned(userId, id);
      const items = await repos.listPlaylistItems(id, userId);
      if (orderedItemIds.length !== items.length) {
        throw new LibraryError(
          "VALIDATION_ERROR",
          "orderedItemIds must contain every item exactly once",
        );
      }
      const owned = new Set(items.map((item) => item.id));
      const seen = new Set<string>();
      for (const itemId of orderedItemIds) {
        if (!owned.has(itemId) || seen.has(itemId)) {
          throw new LibraryError(
            "VALIDATION_ERROR",
            "orderedItemIds must contain every item exactly once",
          );
        }
        seen.add(itemId);
      }
      await repos.reorderPlaylistItems(id, orderedItemIds);
      return metaOf(userId, id);
    },

    async getTrackIds(userId, id) {
      await requireOwned(userId, id);
      const items = await repos.listPlaylistItems(id, userId);
      return items.map((item) => item.track.id);
    },
  };
}
