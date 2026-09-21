/**
 * LibraryPage — tabs Playlists/Liked/History (frontend.md §1) ข้อมูลจริง (Phase 10)
 * - Playlists: grid + สร้าง playlist ใหม่ · Liked: รายการเพลงที่ like · History: กลุ่มตามวัน
 */
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { getAudioEngine } from "../lib/audioEngine";
import {
  useCreatePlaylist,
  useHistory,
  useLikes,
  usePlaylists,
} from "../hooks/useLibrary";
import LikeButton from "../components/LikeButton";
import Spinner from "../components/ui/Spinner";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import type { HistoryEntryDTO, TrackDTO } from "@musicplayer/shared";

const TABS = [
  {
    key: "playlists",
    labelKey: "library:tabPlaylists",
    testId: "library-tab-playlists",
  },
  { key: "liked", labelKey: "library:tabLiked", testId: "library-tab-liked" },
  { key: "history", labelKey: "library:tabHistory", testId: "library-tab-history" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function LibraryPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const active: TabKey = TABS.find((tab) => tab.key === tabParam)?.key ?? "playlists";

  return (
    <div className="px-6 py-6">
      <h1 className="text-2xl font-semibold">{t("library:title")}</h1>

      <div className="mt-4 flex gap-2" role="tablist">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            to={`/library?tab=${tab.key}`}
            role="tab"
            aria-selected={active === tab.key}
            data-testid={tab.testId}
            className={`rounded-full px-4 py-1.5 text-sm ${
              active === tab.key
                ? "bg-emerald-500/20 text-emerald-300"
                : "text-neutral-400 hover:bg-neutral-900"
            }`}
          >
            {t(tab.labelKey)}
          </Link>
        ))}
      </div>

      <div className="mt-6">
        {active === "playlists" && <PlaylistsTab />}
        {active === "liked" && <LikedTab />}
        {active === "history" && <HistoryTab />}
      </div>
    </div>
  );
}

function TrackRow({ track, trailing }: { track: TrackDTO; trailing?: ReactNode }) {
  const { t } = useTranslation();
  const engine = getAudioEngine();
  return (
    <div className="flex items-center border-b border-neutral-900">
      <button
        onClick={() => void engine.play(track)}
        aria-label={`${t("common:play")} ${track.title}`}
        data-testid={`library-play-${track.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 px-2 py-3 text-left hover:bg-neutral-900"
      >
        {track.artworkUrl ? (
          <img
            src={track.artworkUrl}
            alt=""
            loading="lazy"
            className="h-10 w-10 rounded object-cover"
          />
        ) : (
          <div className="h-10 w-10 rounded bg-neutral-800" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{track.title}</span>
          <span className="block truncate text-sm text-neutral-400">
            {track.artist}
          </span>
        </span>
        <span className="text-xs text-neutral-500">
          {Math.floor(track.durationMs / 60_000)}:
          {String(Math.floor((track.durationMs % 60_000) / 1000)).padStart(2, "0")}
        </span>
      </button>
      <LikeButton trackId={track.id} />
      {trailing}
    </div>
  );
}

function PlaylistsTab() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = usePlaylists();
  const create = useCreatePlaylist();
  const [name, setName] = useState("");
  const playlists = data?.playlists ?? [];

  if (isLoading) return <Spinner label={t("common:loading")} />;
  if (isError) {
    return (
      <ErrorState
        message={(error as Error | null)?.message ?? "error"}
        retryLabel={t("common:retry")}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          create.mutate({ name: trimmed }, { onSuccess: () => setName("") });
        }}
        className="flex gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("playlist:newNamePlaceholder")}
          data-testid="library-new-playlist-name"
          className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          data-testid="library-create-playlist"
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-40"
        >
          + {t("library:createPlaylist")}
        </button>
      </form>

      {playlists.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon="📁"
            title={t("library:emptyPlaylistsTitle")}
            description={t("library:emptyPlaylistsDesc")}
            testId="library-empty-playlists"
          />
        </div>
      ) : (
        <ul
          className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4"
          data-testid="library-playlists"
        >
          {playlists.map((playlist) => (
            <li key={playlist.id}>
              <Link
                to={`/playlist/${playlist.id}`}
                data-testid={`library-playlist-${playlist.id}`}
                className="block rounded-xl border border-neutral-800 bg-neutral-950 p-4 hover:border-neutral-600"
              >
                <span className="text-3xl" aria-hidden>
                  📁
                </span>
                <p className="mt-2 truncate text-sm font-medium">{playlist.name}</p>
                <p className="text-xs text-neutral-500">
                  {t("playlist:trackCount", { count: playlist.trackCount })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LikedTab() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useLikes();
  const items = data?.items ?? [];

  if (isLoading) return <Spinner label={t("common:loading")} />;
  if (isError) {
    return (
      <ErrorState
        message={(error as Error | null)?.message ?? "error"}
        retryLabel={t("common:retry")}
        onRetry={() => void refetch()}
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon="💚"
        title={t("library:emptyLikedTitle")}
        description={t("library:emptyLikedDesc")}
        testId="library-empty-liked"
        action={
          <Link
            to="/search"
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400"
          >
            {t("common:nav.search")}
          </Link>
        }
      />
    );
  }
  return (
    <div data-testid="liked-list">
      {items.map((item) => (
        <TrackRow key={item.track.id} track={item.track} />
      ))}
    </div>
  );
}

/** History แบ่งตามวัน (requirements.md §3.3) — วันนี้/เมื่อวาน/วันที่; skip < จบ → tag skipped */
function HistoryTab() {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useHistory();
  const items = data?.items ?? [];

  if (isLoading) return <Spinner label={t("common:loading")} />;
  if (isError) {
    return (
      <ErrorState
        message={(error as Error | null)?.message ?? "error"}
        retryLabel={t("common:retry")}
        onRetry={() => void refetch()}
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon="🕐"
        title={t("library:emptyHistoryTitle")}
        description={t("library:emptyHistoryDesc")}
        testId="library-empty-history"
      />
    );
  }

  const locale = i18n.language === "th" ? "th-TH" : "en-US";
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = startOfDay(new Date());
  const yesterday = today - 86_400_000;

  const groups = new Map<string, { label: string; entries: HistoryEntryDTO[] }>();
  for (const entry of items) {
    const played = new Date(entry.playedAt);
    const dayStart = startOfDay(played);
    const label =
      dayStart === today
        ? t("history:today")
        : dayStart === yesterday
          ? t("history:yesterday")
          : played.toLocaleDateString(locale, {
              day: "numeric",
              month: "long",
              year: "numeric",
            });
    const group = groups.get(label) ?? { label, entries: [] };
    group.entries.push(entry);
    groups.set(label, group);
  }

  return (
    <div data-testid="history-list">
      {[...groups.values()].map((group) => (
        <section key={group.label} className="mt-4 first:mt-0">
          <h2
            className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400"
            data-testid="history-day"
          >
            {group.label}
          </h2>
          {group.entries.map((entry) => (
            <TrackRow
              key={entry.id}
              track={entry.track}
              trailing={
                entry.skipped ? (
                  <span
                    className="mr-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400"
                    data-testid="history-skipped"
                  >
                    {t("history:skipped")}
                  </span>
                ) : (
                  <span className="mr-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                    {t("history:completed")}
                  </span>
                )
              }
            />
          ))}
        </section>
      ))}
    </div>
  );
}
