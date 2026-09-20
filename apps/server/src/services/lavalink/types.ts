/**
 * Types ตาม Lavalink v4 REST API จริง — docs/lavalink.md §6 (https://lavalink.dev/api/rest.html)
 * เฉพาะส่วนที่เราใช้ (loadtracks / decodetrack / info) — session/player ของ Lavalink ไม่ใช้
 */

export interface LavalinkTrackInfo {
  identifier: string;
  isSeekable: boolean;
  author: string;
  length: number;
  isStream: boolean;
  position: number;
  title: string;
  /** source PAGE url — ไม่ใช่ stream url (lavalink.md §9.2) */
  uri?: string | null;
  artworkUrl?: string | null;
  isrc?: string | null;
  sourceName: string;
}

export interface LavalinkTrack {
  encoded: string;
  info: LavalinkTrackInfo;
  /** LavaSrc: { albumName, albumUrl, artistUrl, previewUrl, isLocal } สำหรับ spsearch */
  pluginInfo?: Record<string, unknown>;
  userData?: Record<string, unknown>;
}

export interface LavalinkPlaylistInfo {
  name: string;
  selectedTrack: number;
}

/** loadType ทั้ง 5 แบบ — ครอบด้วย discriminated union */
export type LoadResult =
  | { loadType: "track"; data: LavalinkTrack }
  | { loadType: "search"; data: LavalinkTrack[] }
  | {
      loadType: "playlist";
      data: {
        info: LavalinkPlaylistInfo;
        pluginInfo?: Record<string, unknown>;
        tracks: LavalinkTrack[];
      };
    }
  | { loadType: "empty"; data: null }
  | {
      loadType: "error";
      data: {
        message: string;
        severity: "COMMON" | "SUSPICIOUS" | "FAULT";
        cause?: string;
      };
    };

export interface LavalinkInfo {
  version: { semver: string; major: number; minor: number; patch: number };
  sourceManagers: string[];
  plugins: Array<{ name: string; version: string }>;
}

export type LavalinkFetch = (input: string, init?: RequestInit) => Promise<Response>;
