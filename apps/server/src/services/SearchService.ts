import type { TrackDTO } from "@musicplayer/shared";
import type { TrackUpsert } from "../repositories/tracks.repo.js";
import { LavalinkLoadError } from "./lavalink/errors.js";
import type { LavalinkClient } from "./lavalink/LavalinkClient.js";
import type { LavalinkTrack, LoadResult } from "./lavalink/types.js";

export const SEARCH_SOURCES = {
  yt: "ytsearch:",
  ytm: "ytmsearch:",
} as const;

export type SearchSource = keyof typeof SEARCH_SOURCES;

export interface SearchOptions {
  source?: SearchSource;
  limit?: number;
}

export interface SearchDeps {
  /** ปกติ: (t) => upsertTrack(db, t) — inject เป็น function เพื่อให้ test ได้ seam ที่ไม่แตะ DB */
  upsertTrack: (track: TrackUpsert) => Promise<{ id: string; isNew?: boolean }>;
  lavalink: Pick<LavalinkClient, "loadTracks">;
}

export interface SearchResult {
  tracks: TrackDTO[];
  sources: { available: string[]; degraded: string[] };
}

/**
 * SearchService ตาม backend.md §2 — เรียก LavalinkClient, normalize → TrackDTO, upsert tracks
 * Phase 2: 1 source ต่อ request, ไม่มี local library merge (Phase 6) และไม่มี auth (phase ถัด ๆ ไป)
 */
export function createSearchService(deps: SearchDeps) {
  async function search(q: string, options: SearchOptions = {}): Promise<SearchResult> {
    const source: SearchSource = options.source ?? "yt";
    const limit = options.limit ?? 20;
    const prefix = SEARCH_SOURCES[source];

    const result = await deps.lavalink.loadTracks(`${prefix}${q}`);
    const lavalinkTracks = flattenLoadResult(result).slice(0, limit);

    const tracks: TrackDTO[] = [];
    for (const lavalinkTrack of lavalinkTracks) {
      const { id } = await deps.upsertTrack(toUpsert(lavalinkTrack));
      tracks.push(toDTO(id, lavalinkTrack));
    }

    return {
      tracks,
      sources: { available: [source], degraded: [] },
    };
  }

  return { search };
}

/** แปลง LoadResult ทั้ง 5 loadTypes เป็นรายการ track (playlist → ทั้งชุด, empty → []) */
export function flattenLoadResult(result: LoadResult): LavalinkTrack[] {
  switch (result.loadType) {
    case "track":
      return [result.data];
    case "search":
      return result.data;
    case "playlist":
      return result.data.tracks;
    case "empty":
      return [];
    case "error":
      throw new LavalinkLoadError(result.data.message, result.data.severity);
  }
}

function toUpsert(track: LavalinkTrack): TrackUpsert {
  const info = track.info;
  return {
    sourceName: info.sourceName,
    sourceIdentifier: info.identifier,
    title: info.title,
    artist: info.author,
    album: readAlbum(track.pluginInfo),
    durationMs: info.isStream ? 0 : info.length,
    isStream: info.isStream,
    isSeekable: info.isSeekable,
    artworkUrl: info.artworkUrl ?? null,
    isrc: info.isrc ?? null,
    lavalinkEncoded: track.encoded,
  };
}

function toDTO(id: string, track: LavalinkTrack): TrackDTO {
  const info = track.info;
  return {
    id,
    title: info.title,
    artist: info.author,
    album: readAlbum(track.pluginInfo),
    durationMs: info.isStream ? 0 : info.length,
    isStream: info.isStream,
    isSeekable: info.isSeekable,
    artworkUrl: info.artworkUrl ?? null,
    sourceName: info.sourceName,
    isLiked: false,
  };
}

/** source plugin บางตัวใส่ชื่ออัลบั้มไว้ที่ pluginInfo.albumName */
function readAlbum(pluginInfo: Record<string, unknown> | undefined): string | null {
  const albumName = pluginInfo?.["albumName"];
  return typeof albumName === "string" && albumName.length > 0 ? albumName : null;
}
