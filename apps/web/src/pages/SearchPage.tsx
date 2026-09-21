/** SearchPage — debounce/pagination + VirtualList + states ครบ + like/เพิ่มใน playlist (Phase 10) */
import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { TrackDTO } from "@musicplayer/shared";
import { useSearch } from "../hooks/useSearch";
import { getAudioEngine } from "../lib/audioEngine";
import { queueApi } from "../api";
import { useQueueStore, useToastStore } from "../stores/playerStore";
import { VirtualList } from "../components/ui/VirtualList";
import LikeButton from "../components/LikeButton";
import AddToPlaylistDialog from "../components/AddToPlaylistDialog";
import Spinner from "../components/ui/Spinner";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";

export default function SearchPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [dialogTrackId, setDialogTrackId] = useState<string | null>(null);
  const show = useToastStore((s) => s.show);
  const engine = getAudioEngine();
  const search = useSearch(query);

  function onPlay(track: TrackDTO) {
    engine.ensureAudioGraph();
    void engine.play(track);
  }

  const hasQuery = search.debouncedQuery.length > 0;

  return (
    <div className="px-6 py-6">
      <h1 className="text-2xl font-semibold">{t("common:nav.search")}</h1>

      <form
        onSubmit={(e) => e.preventDefault()}
        className="mt-4 flex gap-2"
        role="search"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search:placeholder")}
          data-testid="search-input"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 outline-none focus:border-neutral-400"
        />
      </form>

      {search.isError && (
        <div className="mt-6">
          <ErrorState
            message={(search.error as Error | null)?.message ?? "error"}
            retryLabel={t("common:retry")}
            onRetry={() => void search.refetch()}
          />
        </div>
      )}

      {!hasQuery && !search.isError && (
        <div className="mt-6">
          <EmptyState icon="🔍" title={t("search:hint")} testId="search-hint" />
        </div>
      )}

      {search.isFetching && hasQuery && <Spinner label={t("search:searching")} />}

      {search.sources.degraded.length > 0 && !search.isFetching && (
        <p className="mt-3 text-xs text-amber-400" data-testid="search-degraded">
          {t("search:degraded", { sources: search.sources.degraded.join(", ") })}
        </p>
      )}

      {!search.isFetching &&
        hasQuery &&
        search.tracks.length === 0 &&
        !search.isError && (
          <div className="mt-6">
            <EmptyState icon="😶‍🌫️" title={t("search:noResults")} testId="search-empty" />
          </div>
        )}

      {search.tracks.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            {t("search:results")}
          </h2>
          <VirtualList
            items={search.tracks}
            itemHeight={72}
            height={Math.min(search.tracks.length * 72, 576)}
            getKey={(track) => track.id}
            renderItem={(track, index) => (
              <div
                key={track.id}
                className="flex items-center border-b border-neutral-900"
                data-testid={`search-row-${index}`}
              >
                <button
                  onClick={() => onPlay(track)}
                  data-testid={`play-${track.id}`}
                  className="flex w-full flex-1 items-center gap-3 px-2 py-3 text-left hover:bg-neutral-900"
                >
                  {track.artworkUrl ? (
                    <img
                      src={track.artworkUrl}
                      alt=""
                      loading="lazy"
                      className="h-12 w-12 rounded object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded bg-neutral-800" />
                  )}
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
                  aria-label={`${t("playlist:addTo")} ${track.title}`}
                  data-testid={`add-playlist-${track.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDialogTrackId(track.id);
                  }}
                  className="rounded-full px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                >
                  + 📁
                </button>
                <Link
                  to={`/track/${track.id}`}
                  aria-label={`${t("search:detail")} ${track.title}`}
                  data-testid={`track-link-${track.id}`}
                  className="rounded-full px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                >
                  {t("search:detail")}
                </Link>
                <button
                  aria-label={`${t("search:addQueue")} ${track.title}`}
                  data-testid={`add-queue-${track.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void queueApi
                      .add([track.id])
                      .then(useQueueStore.getState().setQueueDto)
                      .catch((err) => show(String((err as Error).message)));
                  }}
                  className="mr-1 rounded-full px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                >
                  {t("search:addQueue")}
                </button>
              </div>
            )}
          />
        </section>
      )}

      <AddToPlaylistDialog
        trackIds={dialogTrackId ? [dialogTrackId] : []}
        open={dialogTrackId !== null}
        onClose={() => setDialogTrackId(null)}
      />

      {search.hasMore && !search.isFetching && (
        <button
          data-testid="btn-load-more"
          onClick={search.loadMore}
          className="mt-4 w-full rounded-lg border border-neutral-700 py-2 text-sm text-neutral-300 hover:bg-neutral-900"
        >
          {t("search:loadMore")}
        </button>
      )}
    </div>
  );
}
