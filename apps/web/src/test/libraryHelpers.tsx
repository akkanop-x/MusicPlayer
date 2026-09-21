/**
 * helpers ร่วมของ Phase 10 tests — fetch stub ตาม URL + QueryClientProvider wrapper
 * (api client จริงใช้ fetch + token ใน memory → stub global เดียวพอ ไม่ต้อง vi.mock ทุกโมดูล)
 */
import type { ReactNode } from "react";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HistoryPageDTO, LikesPageDTO, PlaylistDTO } from "@musicplayer/shared";

export interface LibraryFixtures {
  playlists?: PlaylistDTO[];
  playlist?: PlaylistDTO;
  likes?: LikesPageDTO;
  history?: HistoryPageDTO;
}

/** stub global.fetch คืน fixture ตาม path — คืน spy ที่ assert จำนวน call ได้ */
export function stubLibraryFetch(
  fixtures: LibraryFixtures = {
    playlists: [],
    likes: { items: [], nextCursor: null },
    history: { items: [], nextCursor: null },
  },
) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url.replace(/^(https?:\/\/[^/]+)?\/api\/v1/, "")}`);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("/playlists/")) {
      if (method === "GET") {
        if (!fixtures.playlist) {
          return new Response(
            JSON.stringify({ error: { code: "NOT_FOUND", message: "no" } }),
            { status: 404 },
          );
        }
        return json(fixtures.playlist);
      }
      return json(fixtures.playlist ?? {});
    }
    if (url.includes("/playlists"))
      return json({ playlists: fixtures.playlists ?? [] });
    if (url.includes("/likes"))
      return json(fixtures.likes ?? { items: [], nextCursor: null });
    if (url.includes("/history"))
      return json(fixtures.history ?? { items: [], nextCursor: null });
    if (url.includes("/like")) return json({ trackId: "", liked: method === "PUT" });
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

/** QueryClient ใหม่ต่อ test (retry false + gcTime 0 กัน cache ข้าม test) */
export function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

export function withQueryClient(children: ReactNode) {
  return (
    <QueryClientProvider client={newQueryClient()}>{children}</QueryClientProvider>
  );
}
