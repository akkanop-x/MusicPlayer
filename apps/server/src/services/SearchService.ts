import type { TrackDTO } from "@musicplayer/shared";
import type { TrackUpsert } from "../repositories/tracks.repo.js";
import { LavalinkError, LavalinkLoadError } from "./lavalink/errors.js";
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
  offset?: number;
}

export interface SearchDeps {
  /** ปกติ: (t) => upsertTrack(db, t) — inject เป็น function เพื่อให้ test ได้ seam ที่ไม่แตะ DB */
  upsertTrack: (track: TrackUpsert) => Promise<{ id: string; isNew?: boolean }>;
  lavalink: Pick<LavalinkClient, "loadTracks">;
  /** ค้น library ที่เคย resolve (pg_trgm) — fail ได้ (service จะ degrade ให้) */
  searchLibrary: (q: string, limit: number) => Promise<TrackDTO[]>;
}

export interface SearchResult {
  tracks: TrackDTO[];
  sources: { available: string[]; degraded: string[] };
}

/**
 * SearchService ตาม backend.md §2 — เรียก LavalinkClient + ค้น library (pg_trgm)
 * merge library ก่อน remote (เคย resolve = เล่นได้แน่), dedupe by id, fail-soft:
 * lavalink ล่ม → ตอบผล library ที่มี + degraded:[source] (ว่างทั้งคู่ค่อยโยน 503 ต่อ)
 */
export function createSearchService(deps: SearchDeps) {
  async function search(q: string, options: SearchOptions = {}): Promise<SearchResult> {
    const source: SearchSource = options.source ?? "yt";
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const offset = Math.max(options.offset ?? 0, 0);
    // Lavalink /loadtracks คืนชุดเดียวไม่รองรับ pagination จริง — ขอเกิน offset แล้ว slice
    const fetchLimit = Math.min(limit + offset, 50);
    const prefix = SEARCH_SOURCES[source];

    // library fail → degrade "library" แต่ยังคืนผล remote ได้
    const library = await deps.searchLibrary(q, fetchLimit).catch(() => null);

    const available: string[] = [];
    const degraded: string[] = [];
    const remote: TrackDTO[] = [];
    try {
      const result = await deps.lavalink.loadTracks(`${prefix}${q}`);
      const lavalinkTracks = flattenLoadResult(result).slice(0, fetchLimit);
      for (const lavalinkTrack of lavalinkTracks) {
        const { id } = await deps.upsertTrack(toUpsert(lavalinkTrack));
        remote.push(toDTO(id, lavalinkTrack));
      }
      available.push(source);
    } catch (error) {
      if (error instanceof LavalinkError) {
        degraded.push(source);
      } else {
        throw error;
      }
    }

    // fail-soft: lavalink ล่ม + library ว่าง → ไม่มีอะไรจะตอบ โยนต่อให้ route ตอบ 503
    if (degraded.includes(source) && available.length === 0 && !library?.length) {
      throw new LavalinkError("search upstream failed");
    }

    const merged = dedupeById([...(library ?? []), ...remote]).slice(
      offset,
      offset + limit,
    );
    if (library?.length) available.unshift("library");
    return { tracks: merged, sources: { available, degraded } };
  }

  return { search };
}

/** dedupe ตาม id รักษาลำดับแรกที่เจอ — search ทุกครั้ง upsert ลง tracks อยู่แล้ว
 * จึงเจอ id เดียวกันทั้งจาก library และ remote */
function dedupeById(tracks: TrackDTO[]): TrackDTO[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
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
