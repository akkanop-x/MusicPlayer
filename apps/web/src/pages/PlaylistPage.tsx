/**
 * PlaylistPage — /playlist/:id เต็มรูปแบบ (Phase 10, api.md §7)
 * header (ชื่อ/คำอธิบาย/rename) + เล่นทั้งหมด/shuffle + rows (remove, reorder ↑↓, like)
 * ลำดับคือหัวใจของ DoD "เล่นทั้ง playlist ตามลำดับ" — reorder เรียก PATCH order
 */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { getAudioEngine } from "../lib/audioEngine";
import { playerApi } from "../api";
import {
  usePlaylist,
  useRemoveTracksFromPlaylist,
  useReorderPlaylist,
  useUpdatePlaylist,
} from "../hooks/useLibrary";
import { useQueueStore, useToastStore } from "../stores/playerStore";
import LikeButton from "../components/LikeButton";
import Spinner from "../components/ui/Spinner";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import type { TrackDTO } from "@musicplayer/shared";

export default function PlaylistPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams<{ id: string }>();
  const { data: playlist, isLoading, isError, error, refetch } = usePlaylist(id);
  const removeTracks = useRemoveTracksFromPlaylist(id);
  const reorder = useReorderPlaylist(id);
  const update = useUpdatePlaylist(id);
  const show = useToastStore((s) => s.show);
  const setQueueDto = useQueueStore((s) => s.setQueueDto);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const engine = getAudioEngine();
  const tracks = playlist?.tracks ?? [];
  const itemIds = playlist?.itemIds ?? [];

  async function onPlayAll(shuffle: boolean) {
    if (tracks.length === 0) return;
    if (shuffle) {
      // เปิด shuffle ฝั่ง server ก่อนแล้วเล่นตามคิวที่ถูกสับ
      try {
        const queue = await playerApi.setShuffle(true);
        setQueueDto(queue);
      } catch (err) {
        show(String((err as Error).message));
      }
    }
    void engine.playPlaylist(id);
  }

  function onRemove(itemId: string) {
    removeTracks.mutate([itemId]);
  }

  function onMove(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= itemIds.length) return;
    const next = [...itemIds];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    reorder.mutate(next);
  }

  function saveRename() {
    const name = nameDraft.trim();
    if (!name) return;
    update.mutate({ name }, { onSuccess: () => setRenaming(false) });
  }

  return (
    <div className="px-6 py-6">
      <Link to="/library" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← {t("library:title")}
      </Link>

      {isLoading && <Spinner label={t("common:loading")} />}
      {isError && (
        <div className="mt-6">
          <ErrorState
            message={(error as Error | null)?.message ?? "error"}
            retryLabel={t("common:retry")}
            onRetry={() => void refetch()}
          />
        </div>
      )}

      {playlist && (
        <>
          <header className="mt-4 flex flex-wrap items-end gap-4">
            <div className="min-w-0 flex-1">
              {renaming ? (
                <div className="flex gap-2">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveRename()}
                    data-testid="playlist-rename-input"
                    className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-lg outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={saveRename}
                    data-testid="playlist-rename-save"
                    className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400"
                  >
                    {t("common:save")}
                  </button>
                </div>
              ) : (
                <h1
                  className="flex items-center gap-2 truncate text-2xl font-semibold"
                  data-testid="playlist-title"
                >
                  📁 {playlist.name}
                  <button
                    aria-label={t("playlist:rename")}
                    data-testid="playlist-rename"
                    onClick={() => {
                      setNameDraft(playlist.name);
                      setRenaming(true);
                    }}
                    className="rounded-full px-2 text-sm text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                  >
                    ✎
                  </button>
                </h1>
              )}
              {playlist.description && (
                <p className="mt-1 text-sm text-neutral-400">{playlist.description}</p>
              )}
              <p className="mt-1 text-xs text-neutral-500">
                {t("playlist:trackCount", { count: playlist.trackCount })}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => void onPlayAll(false)}
                disabled={tracks.length === 0}
                data-testid="btn-play-playlist"
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                ▶ {t("playlist:playAll")}
              </button>
              <button
                onClick={() => void onPlayAll(true)}
                disabled={tracks.length === 0}
                data-testid="btn-shuffle-playlist"
                className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-40"
              >
                🔀 {t("player:shuffle")}
              </button>
            </div>
          </header>

          {tracks.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                icon="🎵"
                title={t("playlist:emptyTitle")}
                description={t("playlist:emptyDesc")}
                testId="playlist-empty"
                action={
                  <Link
                    to="/search"
                    className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400"
                  >
                    {t("common:nav.search")}
                  </Link>
                }
              />
            </div>
          ) : (
            <ol className="mt-6" data-testid="playlist-tracks">
              {tracks.map((track: TrackDTO, index: number) => (
                <li
                  key={itemIds[index] ?? track.id}
                  className="flex items-center border-b border-neutral-900"
                  data-testid={`playlist-row-${index}`}
                >
                  <button
                    onClick={() => void engine.play(track)}
                    aria-label={`${t("common:play")} ${track.title}`}
                    data-testid={`playlist-play-${index}`}
                    className="flex min-w-0 flex-1 items-center gap-3 px-2 py-3 text-left hover:bg-neutral-900"
                  >
                    <span className="w-6 text-right text-xs text-neutral-500">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {track.title}
                      </span>
                      <span className="block truncate text-sm text-neutral-400">
                        {track.artist}
                      </span>
                    </span>
                    <span className="text-xs text-neutral-500">
                      {Math.floor(track.durationMs / 60_000)}:
                      {String(Math.floor((track.durationMs % 60_000) / 1000)).padStart(
                        2,
                        "0",
                      )}
                    </span>
                  </button>
                  <LikeButton trackId={track.id} />
                  <button
                    aria-label={t("playlist:moveUp")}
                    data-testid={`playlist-up-${index}`}
                    disabled={index === 0}
                    onClick={() => onMove(index, -1)}
                    className="rounded-full px-1.5 py-1 text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-20"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={t("playlist:moveDown")}
                    data-testid={`playlist-down-${index}`}
                    disabled={index === tracks.length - 1}
                    onClick={() => onMove(index, 1)}
                    className="rounded-full px-1.5 py-1 text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-20"
                  >
                    ↓
                  </button>
                  <button
                    aria-label={`${t("playlist:removeTrack")} ${track.title}`}
                    data-testid={`playlist-remove-${index}`}
                    onClick={() => onRemove(itemIds[index] ?? "")}
                    className="mr-1 rounded-full px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-red-400"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
