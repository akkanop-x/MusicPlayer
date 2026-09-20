/**
 * useSearch — frontend.md §3.5: debounce 300 ms (พิมพ์รัว → ยิงครั้งเดียว) + append หน้า
 * ใช้ vi.advanceTimersByTimeAsync/runAllTimersAsync — TanStack Query จัดคิด notify ผ่าน timers
 * และ microtasks ต้อง flush คู่กัน
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSearch, SEARCH_PAGE_SIZE } from "./useSearch";
import type { SearchResponseDTO, TrackDTO } from "@musicplayer/shared";

vi.mock("../api", () => ({
  searchApi: {
    search: vi.fn(),
  },
}));

import { searchApi } from "../api";

function track(id: string): TrackDTO {
  return {
    id,
    title: `Song ${id}`,
    artist: "Artist",
    album: null,
    durationMs: 213_000,
    isStream: false,
    isSeekable: true,
    artworkUrl: null,
    sourceName: "youtube",
    isLiked: false,
  };
}

function response(tracks: TrackDTO[]): SearchResponseDTO {
  return { tracks, sources: { available: ["yt"], degraded: [] } };
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const searchMock = vi.mocked(searchApi.search);

beforeEach(() => {
  searchMock.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** ผ่าน debounce + ให้ TanStack Query จบ fetch/notification ภายใน fake clock */
async function flush() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

describe("useSearch", () => {
  it("debounce: พิมพ์รัว 3 ครั้งใน 300 ms → ยิง /search ครั้งเดียวด้วยค่าสุดท้าย", async () => {
    searchMock.mockResolvedValue(response([track("a")]));
    const { rerender } = renderHook(({ q }: { q: string }) => useSearch(q), {
      initialProps: { q: "" },
      wrapper: makeWrapper(),
    });

    rerender({ q: "ri" });
    rerender({ q: "rick a" });
    rerender({ q: "rick astley" });
    // ยังไม่ครบ debounce → ไม่ยิง
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(searchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith("rick astley", { offset: 0 });
  });

  it("loadMore: หน้าเต็ม limit → hasMore + append หน้าถัดไปต่อท้าย", async () => {
    const page1 = Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) => track(`p1-${i}`));
    const page2 = [track("p2-1")];
    searchMock
      .mockResolvedValueOnce(response(page1))
      .mockResolvedValueOnce(response(page2));

    const { result } = renderHook(({ q }: { q: string }) => useSearch(q), {
      initialProps: { q: "abc" },
      wrapper: makeWrapper(),
    });
    await flush();
    expect(result.current.tracks).toHaveLength(SEARCH_PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await flush();
    expect(searchMock).toHaveBeenLastCalledWith("abc", { offset: SEARCH_PAGE_SIZE });
    expect(result.current.tracks).toHaveLength(SEARCH_PAGE_SIZE + 1);
    expect(result.current.tracks[SEARCH_PAGE_SIZE]?.id).toBe("p2-1");
  });

  it("หน้าสุดท้ายไม่เต็ม limit → hasMore=false (ซ่อนปุ่ม)", async () => {
    searchMock.mockResolvedValue(response([track("only")]));
    const { result } = renderHook(({ q }: { q: string }) => useSearch(q), {
      initialProps: { q: "abc" },
      wrapper: makeWrapper(),
    });
    await flush();
    expect(result.current.hasMore).toBe(false);
  });

  it("พิมพ์ใหม่ → ล้างผลเดิม + เริ่มหน้า 0", async () => {
    searchMock
      .mockResolvedValueOnce(response([track("old")]))
      .mockResolvedValueOnce(response([track("new")]));
    const { result, rerender } = renderHook(({ q }: { q: string }) => useSearch(q), {
      initialProps: { q: "old query" },
      wrapper: makeWrapper(),
    });
    await flush();
    expect(result.current.tracks.map((t) => t.id)).toEqual(["old"]);

    rerender({ q: "new query" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(result.current.tracks.map((t) => t.id)).toEqual(["new"]);
  });

  it("degraded → รวม sources จากทุกหน้า", async () => {
    searchMock
      .mockResolvedValueOnce({
        tracks: [track("a")],
        sources: { available: ["library"], degraded: ["yt"] },
      })
      .mockResolvedValueOnce({ tracks: [], sources: { available: [], degraded: [] } });
    const { result } = renderHook(({ q }: { q: string }) => useSearch(q), {
      initialProps: { q: "abc" },
      wrapper: makeWrapper(),
    });
    await flush();
    expect(result.current.sources.degraded).toEqual(["yt"]);
    act(() => result.current.loadMore());
    await flush();
    expect(result.current.sources.available).toEqual(["library"]);
  });

  it("query ว่าง → enabled=false ไม่ยิง", async () => {
    renderHook(({ q }: { q: string }) => useSearch(q), {
      initialProps: { q: "   " },
      wrapper: makeWrapper(),
    });
    await flush();
    expect(searchMock).not.toHaveBeenCalled();
  });
});
