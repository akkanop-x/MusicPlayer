import type {
  EqPresetDTO,
  PlayerStateDTO,
  QueueStateDTO,
  SearchResponseDTO,
  TrackDTO,
  UserSettingsDTO,
} from "@musicplayer/shared";
import { api, apiJson } from "./client";
import { useAuthStore } from "../stores/authStore";

export interface AuthResult {
  accessToken: string;
  user: { id: string; email: string; displayName: string };
}

export const authApi = {
  register: (email: string, password: string, displayName?: string) =>
    apiJson<AuthResult>("POST", "/auth/register", { email, password, displayName }),
  login: (email: string, password: string) =>
    apiJson<AuthResult>("POST", "/auth/login", { email, password }),
  logout: () => api<void>("/auth/logout", { method: "POST" }),
  me: () => api<AuthResult["user"]>("/me"),
};

export const searchApi = {
  search: (q: string, options: { limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams({ q });
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined && options.offset > 0)
      params.set("offset", String(options.offset));
    return api<SearchResponseDTO>(`/search?${params.toString()}`);
  },
};

export const tracksApi = {
  getById: (id: string) => api<TrackDTO>(`/tracks/${id}`),
  /** batch (api.md endpoint 8) — ใช้ตอนต้อง hydrate หลาย track พร้อมกัน */
  getBatch: (ids: string[]) =>
    api<{ tracks: TrackDTO[] }>(`/tracks?ids=${encodeURIComponent(ids.join(","))}`),
};

export const playerApi = {
  getState: () => api<PlayerStateDTO>("/player"),
  play: (trackId: string) =>
    apiJson<PlayerStateDTO>("POST", "/player/play", { trackId }),
  pause: () => api<PlayerStateDTO>("/player/pause", { method: "POST" }),
  resume: () => api<PlayerStateDTO>("/player/resume", { method: "POST" }),
  seek: (positionMs: number) =>
    apiJson<PlayerStateDTO>("POST", "/player/seek", { positionMs }),
  /** reason="completed" เมื่อเพลงจบเอง (repeat=one จะ replay ตาม queue.md §5) */
  skip: (reason: "completed" | "skip" = "skip") =>
    api<QueueStateDTO>("/player/skip", {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  previous: () => api<PlayerStateDTO>("/player/previous", { method: "POST" }),
  setVolume: (volume: number) =>
    apiJson<PlayerStateDTO>("PATCH", "/player/volume", { volume }),
  setRepeat: (mode: PlayerStateDTO["repeatMode"]) =>
    apiJson<PlayerStateDTO>("PATCH", "/player/repeat", { mode }),
  setShuffle: (enabled: boolean) =>
    apiJson<QueueStateDTO>("PATCH", "/player/shuffle", { enabled }),
};

export const queueApi = {
  getQueue: () => api<QueueStateDTO>("/queue"),
  add: (trackIds: string[]) =>
    apiJson<QueueStateDTO>("POST", "/queue/tracks", { trackIds }),
  addNext: (trackIds: string[]) =>
    apiJson<QueueStateDTO>("POST", "/queue/tracks/next", { trackIds }),
  move: (itemId: string, toPosition: number) =>
    apiJson<QueueStateDTO>("PATCH", `/queue/items/${itemId}/move`, { toPosition }),
  remove: (itemId: string) =>
    api<QueueStateDTO>(`/queue/items/${itemId}`, { method: "DELETE" }),
  clear: (scope: "upcoming" | "all" = "upcoming") =>
    api<QueueStateDTO>(`/queue?scope=${scope}`, { method: "DELETE" }),
};

/** Settings + EQ (api.md §10 #38–44) — equalizer.md §5: เลือก preset apply local ก่อน แล้วค่อยยิง REST */
export const settingsApi = {
  get: () => api<UserSettingsDTO>("/settings"),
  patch: (patch: { volume?: number; muted?: boolean; autoplay?: boolean }) =>
    apiJson<UserSettingsDTO>("PATCH", "/settings", patch),
};

export const eqApi = {
  getPresets: () => api<{ presets: EqPresetDTO[] }>("/eq/presets"),
  createPreset: (name: string, bands: number[]) =>
    apiJson<EqPresetDTO>("POST", "/eq/presets", { name, bands }),
  updatePreset: (id: string, patch: { name?: string; bands?: number[] }) =>
    apiJson<EqPresetDTO>("PATCH", `/eq/presets/${id}`, patch),
  deletePreset: (id: string) => api<void>(`/eq/presets/${id}`, { method: "DELETE" }),
  setActive: (presetId: string | null) =>
    apiJson<UserSettingsDTO>("PUT", "/eq/active", { presetId }),
};

/** ฟื้นเซสชันตอนโหลดหน้า — ลอง refresh เงียบ ๆ แล้วดึง /me */
export async function hydrateSession(): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/auth/refresh", { method: "POST" });
    if (!res.ok) return false;
    const body = (await res.json()) as { accessToken?: string };
    if (!body.accessToken) return false;
    useAuthStore.getState().setAccessToken(body.accessToken);
    return true;
  } catch {
    return false;
  }
}

export type { TrackDTO };
