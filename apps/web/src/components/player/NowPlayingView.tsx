/** NowPlayingView — fullscreen overlay (frontend.md: NowPlayingView) — เปิดจากปุ่มขยายใน PlayerBar */
import { useTranslation } from "react-i18next";
import { getAudioEngine } from "../../lib/audioEngine";
import { usePlayerStore, useProgressStore, useUiStore } from "../../stores/playerStore";

function fmt(ms: number): string {
  const s = Math.max(Math.floor(ms / 1000), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function NowPlayingView() {
  const { t } = useTranslation();
  const engine = getAudioEngine();
  const open = useUiStore((s) => s.isNowPlayingOpen);
  const setOpen = useUiStore((s) => s.setNowPlayingOpen);
  const { state, track, volume, muted, repeatMode } = usePlayerStore();
  const { positionMs, durationMs, scrubMs, setScrub } = useProgressStore();

  if (!open) return null;
  const position = scrubMs ?? positionMs;
  const duration = durationMs || track?.durationMs || 0;
  const isPlaying = state === "PLAYING";

  return (
    <div
      data-testid="now-playing"
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-gradient-to-b from-neutral-900 via-neutral-950 to-black px-8 py-8"
    >
      <header className="flex w-full max-w-md items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-neutral-500">
          {t("nowPlaying:upNext")}
        </span>
        <button
          aria-label={t("player:collapse")}
          data-testid="now-playing-close"
          onClick={() => setOpen(false)}
          className="rounded-full p-2 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          ⌄
        </button>
      </header>

      <div className="flex flex-col items-center gap-6">
        {track?.artworkUrl ? (
          <img
            src={track.artworkUrl}
            alt=""
            data-testid="now-playing-artwork"
            className="h-64 w-64 rounded-2xl object-cover shadow-2xl"
          />
        ) : (
          <div
            data-testid="now-playing-artwork"
            className="flex h-64 w-64 items-center justify-center rounded-2xl bg-neutral-800 text-5xl shadow-2xl"
          >
            ♪
          </div>
        )}
        <div className="text-center">
          <h1 className="text-xl font-semibold">{track?.title ?? t("player:idle")}</h1>
          <p className="mt-1 text-sm text-neutral-400">{track?.artist ?? ""}</p>
        </div>
      </div>

      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <span className="w-10 text-right text-xs text-neutral-400">
            {fmt(position)}
          </span>
          <input
            aria-label={t("player:seek")}
            data-testid="now-playing-seek"
            type="range"
            min={0}
            max={Math.max(duration, 1)}
            value={position}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={(e) => {
              const ms = Number((e.target as HTMLInputElement).value);
              setScrub(null);
              void engine.seek(ms);
            }}
            onKeyUp={(e) => {
              const ms = Number((e.target as HTMLInputElement).value);
              setScrub(null);
              void engine.seek(ms);
            }}
            disabled={!track?.isSeekable}
            className="h-1 flex-1 accent-emerald-500"
          />
          <span className="w-10 text-xs text-neutral-400">{fmt(duration)}</span>
        </div>

        <div className="flex items-center justify-center gap-6">
          <button
            aria-label={t("player:shuffleOff")}
            data-testid="now-playing-shuffle"
            onClick={() => void engine.setShuffle(!usePlayerStore.getState().shuffle)}
            className={`text-lg ${
              usePlayerStore.getState().shuffle
                ? "text-emerald-400"
                : "text-neutral-400"
            }`}
          >
            🔀
          </button>
          <button
            aria-label={t("player:previous")}
            data-testid="now-playing-previous"
            onClick={() => void engine.previous()}
            className="text-2xl text-neutral-200"
          >
            ⏮
          </button>
          <button
            aria-label={isPlaying ? t("player:pause") : t("player:play")}
            data-testid="now-playing-toggle"
            onClick={() => {
              engine.ensureAudioGraph();
              if (isPlaying || state === "BUFFERING" || state === "LOADING") {
                void engine.pause();
              } else if (state === "PAUSED") {
                void engine.resume();
              } else if (track) {
                void engine.play(track);
              }
            }}
            className="rounded-full bg-emerald-500 p-5 text-2xl text-neutral-950 hover:bg-emerald-400"
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            aria-label={t("player:skip")}
            data-testid="now-playing-skip"
            onClick={() => void engine.skip()}
            className="text-2xl text-neutral-200"
          >
            ⏭
          </button>
          <button
            aria-label={t("player:repeatOff")}
            data-testid="now-playing-repeat"
            onClick={() =>
              engine.setRepeat(
                repeatMode === "off" ? "one" : repeatMode === "one" ? "all" : "off",
              )
            }
            className={`text-lg ${
              repeatMode === "off" ? "text-neutral-400" : "text-emerald-400"
            }`}
          >
            🔁
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span aria-hidden className="text-sm text-neutral-500">
            🔈
          </span>
          <input
            aria-label={t("player:volume")}
            data-testid="now-playing-volume"
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            onChange={(e) => engine.setVolume(Number(e.target.value))}
            className="h-1 flex-1 accent-emerald-500"
          />
        </div>
      </div>
    </div>
  );
}
