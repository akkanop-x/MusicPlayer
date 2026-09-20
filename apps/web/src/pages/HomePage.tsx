import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TrackDTO } from "@musicplayer/shared";
import { searchApi, authApi } from "../api";
import { getAudioEngine } from "../lib/audioEngine";
import { useToastStore } from "../stores/playerStore";
import PlayerBar from "../components/PlayerBar";

/** หน้า demo ของ Phase 4 — search (หยาบ ๆ) + กดเล่นผ่าน AudioEngine + PlayerBar */
export default function HomePage() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const show = useToastStore((s) => s.show);
  const engine = getAudioEngine();

  const search = useQuery({
    queryKey: ["search", submitted],
    queryFn: () => searchApi.search(submitted),
    enabled: submitted.length > 0,
  });

  function onPlay(track: TrackDTO) {
    // first gesture → ต่อ Web Audio graph (edge #8)
    engine.ensureAudioGraph();
    void engine.play(track);
  }

  return (
    <main className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold">MusicPlayer</h1>
        <button
          onClick={() => {
            void authApi.logout().finally(() => window.location.assign("/login"));
          }}
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          ออกจากระบบ
        </button>
      </header>

      <section className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-6 pb-40">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาเพลงจาก YouTube…"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 outline-none focus:border-neutral-400"
          />
          <button
            type="submit"
            className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400"
          >
            ค้นหา
          </button>
        </form>

        {search.isFetching && <p className="text-sm text-neutral-400">กำลังค้นหา…</p>}
        {search.isError && (
          <p className="text-sm text-red-400">{(search.error as Error).message}</p>
        )}

        <ul className="divide-y divide-neutral-800">
          {search.data?.tracks.map((track) => (
            <li key={track.id}>
              <button
                onClick={() => onPlay(track)}
                className="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-neutral-900"
              >
                {track.artworkUrl ? (
                  <img
                    src={track.artworkUrl}
                    alt=""
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
            </li>
          ))}
        </ul>
      </section>

      <PlayerBar onToast={show} />
    </main>
  );
}
