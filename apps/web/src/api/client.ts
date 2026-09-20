/**
 * API client — backend.md §4: ทุก response error ใช้ shape { error: { code, message } }
 * access token อยู่ใน memory (authStore); refresh ผ่าน httpOnly cookie เดิม (security.md §1)
 */
import { useAuthStore } from "../stores/authStore";

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let refreshing: Promise<boolean> | null = null;

/** พยายาม refresh access token ด้วย refresh cookie (ครั้งเดียวต่อ concurrent burst) */
export async function tryRefresh(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: "POST" })
    .then(async (res) => {
      if (!res.ok) return false;
      const body = (await res.json()) as { accessToken?: string };
      if (!body.accessToken) return false;
      useAuthStore.getState().setAccessToken(body.accessToken);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && retry && token) {
    if (await tryRefresh()) return api<T>(path, init, false);
    // refresh ไม่รอด → เซสชันหมดอายุจริง
    useAuthStore.getState().clear();
    window.location.assign("/login");
    throw new ApiError(401, "UNAUTHENTICATED", "Session expired");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "INTERNAL",
      body?.error?.message ?? `HTTP ${response.status}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function apiJson<T>(method: string, path: string, body: unknown): Promise<T> {
  return api<T>(path, { method, body: JSON.stringify(body) });
}
