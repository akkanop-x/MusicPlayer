import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { TrackDTO } from "@musicplayer/shared";
import { authApi, queueApi } from "../api";
import { useSearch } from "../hooks/useSearch";
import { getAudioEngine } from "../lib/audioEngine";
import { useQueueStore, useToastStore } from "../stores/playerStore";
import PlayerBar from "../components/PlayerBar";
import QueuePanel from "../components/QueuePanel";

/** Phase 6 — search เต็มรูปแบบ: ค้นขณะพิมพ์ (debounce 300 ms) + pagination + merged library */
export default function HomePage() {
  const [query, setQuery] = useState("");
  const show = useToastStore((s) => s.show);
  const engine = getAudioEngine();
  const search = useSearch(query);

  // sync player+queue จาก server ตอนเปิดหน้า (restore snapshot หลัง refresh/restart)
  useEffect(() => {
    void engine.syncFromServer();
  }, [engine]);

  function onPlay(track: TrackDTO) {
    // first gesture → ต่อ Web Audio graph (edge #8)
    engine.ensureAudioGraph();
    void engine.play(track);
  }

  return (
    <main className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold">MusicPlayer</h1>
        <div className="flex items-center gap-4">
          <Link
            to="/settings"
            data-testid="settings-link"
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            ตั้งค่า
          </Link>
          <button
            onClick={() => {
              void authApi.logout().finally(() => window.location.assign("/login"));
            }}
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            ออกจากระบบ
          </button>
        </div>
      </header>

      <section className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-6 pb-40">
        <form onSubmit={(e) => e.preventDefault()} className="flex gap-2" role="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาเพลงจาก YouTube / YTMusic…"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 outline-none focus:border-neutral-400"
          />
        </form>

        {search.isFetching && <p className="text-sm text-neutral-400">กำลังค้นหา…</p>}
        {search.isError && (
          <p className="text-sm text-red-400">{(search.error as Error).message}</p>
        )}
        {search.sources.degraded.length > 0 && !search.isFetching && (
          <p className="text-xs text-amber-400" data-testid="search-degraded">
            บางแหล่งค้นหาใช้ไม่ได้ชั่วคราว ({search.sources.degraded.join(", ")}) —
            แสดงเฉพาะผลที่หาได้
          </p>
        )}

        <ul className="divide-y divide-neutral-800" data-testid="search-results">
          {search.tracks.map((track) => (
            <li key={track.id} className="flex items-center">
              <button
                onClick={() => onPlay(track)}
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
              <Link
                to={`/track/${track.id}`}
                aria-label={`track detail ${track.title}`}
                data-testid={`track-link-${track.id}`}
                className="rounded-full px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              >
                รายละเอียด
              </Link>
              <button
                aria-label={`add to queue ${track.title}`}
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
                ＋ คิว
              </button>
            </li>
          ))}
        </ul>

        {search.hasMore && !search.isFetching && (
          <button
            data-testid="btn-load-more"
            onClick={search.loadMore}
            className="w-full rounded-lg border border-neutral-700 py-2 text-sm text-neutral-300 hover:bg-neutral-900"
          >
            โหลดเพลงเพิ่มเติม
          </button>
        )}
      </section>

      <div className="mx-auto w-full max-w-4xl px-6">
        <QueuePanel />
      </div>

      <PlayerBar onToast={show} />
    </main>
  );
}
