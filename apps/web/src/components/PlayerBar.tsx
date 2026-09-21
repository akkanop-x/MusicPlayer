import type { TrackDTO } from "@musicplayer/shared";
import { useTranslation } from "react-i18next";
import { getAudioEngine } from "../lib/audioEngine";
import {
  useIntentStore,
  usePlayerStore,
  useProgressStore,
  useUiStore,
} from "../stores/playerStore";

function fmt(ms: number): string {
  const s = Math.max(Math.floor(ms / 1000), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** PlayerBar — คำสั่งครบ + shuffle + ขยาย NowPlaying (frontend.md §1 player/) */
export default function PlayerBar({ onToast }: { onToast?: (m: string) => void }) {
  const { t } = useTranslation();
  const engine = getAudioEngine();
  const { state, track, volume, muted, repeatMode, shuffle, autoplay } =
    usePlayerStore();
  const { positionMs, durationMs, scrubMs, setScrub } = useProgressStore();
  const pendingTrack = useIntentStore((s) => s.pendingTrack);
  const setNowPlayingOpen = useUiStore((s) => s.setNowPlayingOpen);

  const shown: TrackDTO | null = track ?? pendingTrack;
  const isBusy = state === "LOADING" || state === "BUFFERING";
  const position = scrubMs ?? positionMs;
  const duration = durationMs || shown?.durationMs || 0;

  function togglePlay() {
    engine.ensureAudioGraph();
    if (state === "PLAYING" || state === "BUFFERING" || state === "LOADING") {
      void engine.pause().catch(() => onToast?.(t("toast:pauseFailed")));
    } else if (state === "PAUSED") {
      void engine.resume().catch(() => onToast?.(t("toast:resumeFailed")));
    } else if (shown) {
      void engine.play(shown).catch(() => onToast?.(t("toast:playFailed")));
    }
  }

  return (
    <footer
      data-testid="player-bar"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-900/95 px-4 py-3 backdrop-blur md:px-6"
    >
      <div className="mx-auto flex max-w-4xl items-center gap-2 md:gap-4">
        {/* ซ้าย: track + ขยาย */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {shown?.artworkUrl ? (
            <img
              src={shown.artworkUrl}
              alt=""
              className="h-10 w-10 rounded object-cover"
            />
          ) : (
            <div className="h-10 w-10 rounded bg-neutral-800" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {shown?.title ?? t("player:idle")}
            </p>
            <p className="truncate text-xs text-neutral-400">
              {isBusy ? t("player:loadingTrack") : (shown?.artist ?? "")}
            </p>
          </div>
          {shown && (
            <button
              aria-label={t("player:expand")}
              data-testid="btn-expand"
              onClick={() => setNowPlayingOpen(true)}
              className="hidden rounded-full p-2 text-neutral-300 hover:bg-neutral-800 sm:block"
            >
              ⤢
            </button>
          )}
        </div>

        {/* กลาง: controls */}
        <div className="flex items-center gap-1 md:gap-2">
          <button
            aria-label={t("player:shuffleOff")}
            data-testid="btn-shuffle"
            onClick={() => void engine.setShuffle(!shuffle)}
            className={`rounded-full p-2 text-sm ${
              shuffle ? "text-emerald-400" : "text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            🔀
          </button>
          <button
            aria-label={t("player:previous")}
            data-testid="btn-previous"
            onClick={() => void engine.previous()}
            className="rounded-full p-2 text-neutral-300 hover:bg-neutral-800"
          >
            ⏮
          </button>
          <button
            aria-label={
              state === "PLAYING" || isBusy ? t("player:pause") : t("player:play")
            }
            data-testid="btn-toggle"
            onClick={togglePlay}
            disabled={!shown && state === "IDLE"}
            className="rounded-full bg-emerald-500 p-3 text-neutral-950 hover:bg-emerald-400 disabled:opacity-40"
          >
            {state === "PLAYING" && !isBusy ? "⏸" : "▶"}
          </button>
          <button
            aria-label={t("player:skip")}
            data-testid="btn-skip"
            onClick={() => void engine.skip()}
            className="rounded-full p-2 text-neutral-300 hover:bg-neutral-800"
          >
            ⏭
          </button>
        </div>

        {/* ขวา: autoplay + seek + repeat + volume */}
        <div className="hidden flex-1 items-center gap-2 lg:flex">
          <span
            data-testid="position"
            className="w-10 text-right text-xs text-neutral-400"
          >
            {fmt(position)}
          </span>
          <input
            aria-label={t("player:seek")}
            data-testid="seek-bar"
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
            disabled={!shown?.isSeekable}
            className="h-1 flex-1 accent-emerald-500"
          />
          <span data-testid="duration" className="w-10 text-xs text-neutral-400">
            {fmt(duration)}
          </span>
        </div>

        <button
          aria-label={t("player:autoplayAria")}
          aria-pressed={autoplay}
          data-testid="btn-autoplay"
          onClick={() => void engine.setAutoplay(!autoplay)}
          className={`hidden rounded-full px-2 py-1 text-xs sm:block ${
            autoplay
              ? "bg-emerald-500/20 text-emerald-400"
              : "text-neutral-400 hover:bg-neutral-800"
          }`}
        >
          ⚡ {t("player:autoplay")}
        </button>

        <button
          aria-label={t(
            `player:repeat${repeatMode.charAt(0).toUpperCase()}${repeatMode.slice(1)}`,
          )}
          data-testid="btn-repeat"
          onClick={() =>
            engine.setRepeat(
              repeatMode === "off" ? "one" : repeatMode === "one" ? "all" : "off",
            )
          }
          className={`hidden rounded-full px-2 py-1 text-xs sm:block ${
            repeatMode === "off"
              ? "text-neutral-400"
              : "bg-emerald-500/20 text-emerald-400"
          }`}
        >
          🔁 {repeatMode}
        </button>

        <input
          aria-label={t("player:volume")}
          data-testid="volume"
          type="range"
          min={0}
          max={100}
          value={muted ? 0 : volume}
          onChange={(e) => engine.setVolume(Number(e.target.value))}
          className="hidden h-1 w-20 accent-emerald-500 sm:block"
        />
      </div>
    </footer>
  );
}
