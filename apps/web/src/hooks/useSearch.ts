/**
 * useSearch — frontend.md §3.5: debounce 300 ms, TanStack Query cache ตาม query key,
 * staleTime 60 s (server state ล้วน ไม่เก็บใน Zustand)
 * pagination ผ่าน useInfiniteQuery (append หน้า) — ปุ่ม "โหลดเพลงเพิ่มเติม" เรียก loadMore()
 */
import { useDebouncedValue } from "./useDebouncedValue";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { SearchResponseDTO } from "@musicplayer/shared";
import { searchApi } from "../api";

export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 300;

interface SearchPage extends SearchResponseDTO {
  offset: number;
}

export function useSearch(query: string) {
  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  const query_ = useInfiniteQuery({
    queryKey: ["search", debounced],
    queryFn: async ({ pageParam }): Promise<SearchPage> => {
      const res = await searchApi.search(debounced, { offset: pageParam });
      return { ...res, offset: pageParam };
    },
    initialPageParam: 0,
    /** หน้าเต็ม limit → มีหน้าถัดไป (offset ถัดไป = จำนวนหน้าที่โหลดแล้ว × limit) */
    getNextPageParam: (lastPage, allPages) =>
      lastPage.tracks.length >= SEARCH_PAGE_SIZE
        ? allPages.length * SEARCH_PAGE_SIZE
        : undefined,
    enabled: debounced.length > 0,
    staleTime: 60_000,
  });

  // search ทุกครั้ง upsert → track เดียวกันอาจปรากฏหลายหน้า (library/remote) — dedupe รักษาลำดับ
  const seen = new Set<string>();
  const tracks = (query_.data?.pages.flatMap((page) => page.tracks) ?? []).filter(
    (track) => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    },
  );

  const sources = (query_.data?.pages ?? []).reduce<SearchResponseDTO["sources"]>(
    (acc, page) => ({
      available: [...new Set([...acc.available, ...page.sources.available])],
      degraded: [...new Set([...acc.degraded, ...page.sources.degraded])],
    }),
    { available: [], degraded: [] },
  );

  return {
    debouncedQuery: debounced,
    tracks,
    sources,
    isFetching: query_.isFetching,
    isError: query_.isError,
    error: (query_.error as Error | null) ?? null,
    /** มีหน้าถัดไปให้โหลด (หน้าล่าสุดได้เต็ม limit) */
    hasMore: query_.hasNextPage,
    loadMore: () => void query_.fetchNextPage(),
    refetch: () => void query_.refetch(),
  };
}
