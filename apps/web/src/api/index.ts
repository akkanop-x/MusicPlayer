import type {
  PlayerStateDTO,
  QueueStateDTO,
  SearchResponseDTO,
  TrackDTO,
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
  search: (q: string, limit = 20) =>
    api<SearchResponseDTO>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),
};

export const playerApi = {
  getState: () => api<PlayerStateDTO>("/player"),
  play: (trackId: string) =>
    apiJson<PlayerStateDTO>("POST", "/player/play", { trackId }),
  pause: () => api<PlayerStateDTO>("/player/pause", { method: "POST" }),
  resume: () => api<PlayerStateDTO>("/player/resume", { method: "POST" }),
  seek: (positionMs: number) =>
    apiJson<PlayerStateDTO>("POST", "/player/seek", { positionMs }),
  skip: () => api<QueueStateDTO>("/player/skip", { method: "POST" }),
  previous: () => api<PlayerStateDTO>("/player/previous", { method: "POST" }),
  setVolume: (volume: number) =>
    apiJson<PlayerStateDTO>("PATCH", "/player/volume", { volume }),
  setRepeat: (mode: PlayerStateDTO["repeatMode"]) =>
    apiJson<PlayerStateDTO>("PATCH", "/player/repeat", { mode }),
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
