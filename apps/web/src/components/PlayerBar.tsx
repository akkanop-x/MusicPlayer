import type { TrackDTO } from "@musicplayer/shared";
import { getAudioEngine } from "../lib/audioEngine";
import {
  useIntentStore,
  usePlayerStore,
  useProgressStore,
} from "../stores/playerStore";

function fmt(ms: number): string {
  const s = Math.max(Math.floor(ms / 1000), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** PlayerBar หยาบ ๆ ตาม roadmap Phase 4 — ปุ่มครบ, seek bar, volume */
export default function PlayerBar({ onToast }: { onToast?: (m: string) => void }) {
  const engine = getAudioEngine();
  const { state, track, volume, muted, repeatMode } = usePlayerStore();
  const { positionMs, durationMs, scrubMs, setScrub } = useProgressStore();
  const pendingTrack = useIntentStore((s) => s.pendingTrack);

  const shown: TrackDTO | null = track ?? pendingTrack;
  const isBusy = state === "LOADING" || state === "BUFFERING";
  const position = scrubMs ?? positionMs;
  const duration = durationMs || shown?.durationMs || 0;

  function togglePlay() {
    engine.ensureAudioGraph();
    if (state === "PLAYING" || state === "BUFFERING" || state === "LOADING") {
      void engine.pause().catch(() => onToast?.("pause ไม่สำเร็จ"));
    } else if (state === "PAUSED") {
      void engine.resume().catch(() => onToast?.("resume ไม่สำเร็จ"));
    } else if (shown) {
      void engine.play(shown).catch(() => onToast?.("play ไม่สำเร็จ"));
    }
  }

  return (
    <footer
      data-testid="player-bar"
      className="fixed inset-x-0 bottom-0 border-t border-neutral-800 bg-neutral-900/95 px-6 py-3 backdrop-blur"
    >
      <div className="mx-auto flex max-w-4xl items-center gap-4">
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
              {shown?.title ?? "ยังไม่ได้เล่นอะไร"}
            </p>
            <p className="truncate text-xs text-neutral-400">
              {isBusy ? "กำลังโหลด…" : (shown?.artist ?? "")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            aria-label="previous"
            data-testid="btn-previous"
            onClick={() => void engine.previous()}
            className="rounded-full p-2 text-neutral-300 hover:bg-neutral-800"
          >
            ⏮
          </button>
          <button
            aria-label={state === "PLAYING" || isBusy ? "pause" : "play"}
            data-testid="btn-toggle"
            onClick={togglePlay}
            disabled={!shown && state === "IDLE"}
            className="rounded-full bg-emerald-500 p-3 text-neutral-950 hover:bg-emerald-400 disabled:opacity-40"
          >
            {state === "PLAYING" && !isBusy ? "⏸" : "▶"}
          </button>
          <button
            aria-label="skip"
            data-testid="btn-skip"
            onClick={() => void engine.skip()}
            className="rounded-full p-2 text-neutral-300 hover:bg-neutral-800"
          >
            ⏭
          </button>
        </div>

        <div className="flex flex-1 items-center gap-2">
          <span
            data-testid="position"
            className="w-10 text-right text-xs text-neutral-400"
          >
            {fmt(position)}
          </span>
          <input
            aria-label="seek"
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
          aria-label={`repeat ${repeatMode}`}
          data-testid="btn-repeat"
          onClick={() =>
            engine.setRepeat(
              repeatMode === "off" ? "one" : repeatMode === "one" ? "all" : "off",
            )
          }
          className={`rounded-full px-2 py-1 text-xs ${
            repeatMode === "off"
              ? "text-neutral-400"
              : "bg-emerald-500/20 text-emerald-400"
          }`}
        >
          🔁 {repeatMode}
        </button>

        <input
          aria-label="volume"
          data-testid="volume"
          type="range"
          min={0}
          max={100}
          value={muted ? 0 : volume}
          onChange={(e) => engine.setVolume(Number(e.target.value))}
          className="h-1 w-20 accent-emerald-500"
        />
      </div>
    </footer>
  );
}
