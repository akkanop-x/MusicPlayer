/**
 * useLibrary — Phase 10 hooks (frontend.md §3.5: server state ผ่าน TanStack Query)
 * - usePlaylists/usePlaylist/useHistory: query ตรง ๆ
 * - useLikedIds: Set<trackId> cache ["likes","ids"] — LikeButton อ่าน + LIKES_CHANGED/optimistic แก้
 * - useLikeMutation: optimistic toggle (rollback ตอน error) — api.md §8 PUT/DELETE idempotent
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HistoryPageDTO, PlaylistDTO } from "@musicplayer/shared";
import { historyApi, likesApi, playlistsApi } from "../api";
import { useToastStore } from "../stores/playerStore";

// ---------- playlists ----------

export function usePlaylists() {
  return useQuery({
    queryKey: ["playlists"],
    queryFn: () => playlistsApi.list(),
    staleTime: 30_000,
  });
}

export function usePlaylist(id: string) {
  return useQuery({
    queryKey: ["playlist", id],
    queryFn: () => playlistsApi.get(id),
    enabled: id.length > 0,
  });
}

function invalidatePlaylists(
  client: ReturnType<typeof useQueryClient>,
  id?: string,
): void {
  void client.invalidateQueries({ queryKey: ["playlists"] });
  if (id) void client.invalidateQueries({ queryKey: ["playlist", id] });
}

export function useCreatePlaylist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      playlistsApi.create(input.name, input.description),
    onSuccess: () => invalidatePlaylists(client),
    onError: (error) => useToastStore.getState().show(String(error.message)),
  });
}

export function useUpdatePlaylist(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: { name?: string; description?: string | null }) =>
      playlistsApi.update(id, patch),
    onSuccess: () => invalidatePlaylists(client, id),
    onError: (error) => useToastStore.getState().show(String(error.message)),
  });
}

export function useDeletePlaylist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => playlistsApi.remove(id),
    onSuccess: () => invalidatePlaylists(client),
    onError: (error) => useToastStore.getState().show(String(error.message)),
  });
}

export function useAddTracksToPlaylist(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (trackIds: string[]) => playlistsApi.addTracks(id, trackIds),
    onSuccess: () => invalidatePlaylists(client, id),
    onError: (error) => useToastStore.getState().show(String(error.message)),
  });
}

/** ใช้ใน AddToPlaylistDialog — เพิ่มเข้า playlist ใด ๆ (invalidate ทุก cache ที่เกี่ยว) */
export function useAddTracksToPlaylistAny() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { playlistId: string; trackIds: string[] }) =>
      playlistsApi.addTracks(input.playlistId, input.trackIds),
    onSuccess: (_data, input) => invalidatePlaylists(client, input.playlistId),
    onError: (error) => useToastStore.getState().show(String(error.message)),
  });
}

export function useRemoveTracksFromPlaylist(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) => playlistsApi.removeTracks(id, itemIds),
    onSuccess: () => invalidatePlaylists(client, id),
    onError: (error) => useToastStore.getState().show(String(error.message)),
  });
}

export function useReorderPlaylist(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (orderedItemIds: string[]) => playlistsApi.reorder(id, orderedItemIds),
    onSuccess: () => invalidatePlaylists(client, id),
    onError: (error) => useToastStore.getState().show(String(error.message)),
  });
}

// ---------- likes ----------

/** Set ของ trackId ที่ like — ตัวจริงของหัวใจทุกจุด (แก้ทั้ง optimistic + LIKES_CHANGED) */
export function useLikedIds() {
  return useQuery({
    queryKey: ["likes", "ids"],
    queryFn: async () => {
      const res = await likesApi.list({ limit: 200 });
      return new Set(res.items.map((item) => item.track.id));
    },
    staleTime: 60_000,
  });
}

export function useLikes() {
  return useQuery({
    queryKey: ["likes"],
    queryFn: () => likesApi.list({ limit: 200 }),
    staleTime: 30_000,
  });
}

export function useLikeMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { trackId: string; liked: boolean }) =>
      input.liked ? likesApi.like(input.trackId) : likesApi.unlike(input.trackId),
    // optimistic: แก้ Set ใน ["likes","ids"] ทันที + list cache ถ้ามี
    onMutate: async ({ trackId, liked }) => {
      await client.cancelQueries({ queryKey: ["likes", "ids"] });
      const previous = client.getQueryData<Set<string>>(["likes", "ids"]);
      const next = new Set(previous ?? new Set<string>());
      if (liked) next.add(trackId);
      else next.delete(trackId);
      client.setQueryData(["likes", "ids"], next);
      const list = client.getQueryData<{ items: { track: { id: string } }[] }>([
        "likes",
      ]);
      if (list) {
        client.setQueryData(["likes"], {
          ...list,
          items: liked
            ? list.items
            : list.items.filter((item) => item.track.id !== trackId),
        });
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        client.setQueryData(["likes", "ids"], context.previous);
      }
      useToastStore.getState().show(String(error.message));
    },
  });
}

/** LIKES_CHANGED (websocket.md §3) — อุปกรณ์อื่น like/unlike → sync cache เดียวกัน */
export function applyLikesChanged(
  client: ReturnType<typeof useQueryClient>,
  trackId: string,
  liked: boolean,
): void {
  const previous = client.getQueryData<Set<string>>(["likes", "ids"]);
  const next = new Set(previous ?? new Set<string>());
  if (liked) next.add(trackId);
  else next.delete(trackId);
  client.setQueryData(["likes", "ids"], next);
  void client.invalidateQueries({ queryKey: ["likes"] });
}

// ---------- history ----------

export function useHistory() {
  return useQuery({
    queryKey: ["history"],
    queryFn: () => historyApi.list({ limit: 100 }),
    staleTime: 15_000,
  });
}

export type { HistoryPageDTO, PlaylistDTO };
