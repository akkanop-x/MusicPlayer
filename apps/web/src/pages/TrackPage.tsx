/**
 * /track/:id — roadmap Phase 6 "Track page/detail": รายละเอียดเพลง (api.md endpoint 7)
 * พร้อมปุ่ม play/add-to-queue — PlayerBar/QueuePanel อยู่ระดับ layout ไม่ unmount
 */
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { tracksApi, queueApi } from "../api";
import { getAudioEngine } from "../lib/audioEngine";
import { useQueueStore, useToastStore } from "../stores/playerStore";
import PlayerBar from "../components/PlayerBar";
import QueuePanel from "../components/QueuePanel";

function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const show = useToastStore((s) => s.show);
  const engine = getAudioEngine();

  const trackQuery = useQuery({
    queryKey: ["track", id],
    queryFn: () => tracksApi.getById(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
    retry: false,
  });

  const track = trackQuery.data;

  return (
    <main className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between px-6 py-4">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          {t("common:back")}
        </button>
        <h1 className="text-lg font-semibold">{t("track:title")}</h1>
        <span className="w-10" />
      </header>

      <section className="mx-auto w-full max-w-2xl flex-1 px-6 pb-40">
        {trackQuery.isPending && (
          <p className="text-sm text-neutral-400">{t("common:loading")}</p>
        )}
        {trackQuery.isError && (
          <div className="space-y-3">
            <p className="text-sm text-red-400">{t("track:notFound")}</p>
            <button
              onClick={() => navigate("/")}
              className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400"
            >
              {t("common:backToSearch")}
            </button>
          </div>
        )}

        {track && (
          <div className="space-y-6" data-testid="track-detail">
            <div className="flex items-center gap-5">
              {track.artworkUrl ? (
                <img
                  src={track.artworkUrl}
                  alt=""
                  className="h-32 w-32 rounded-lg object-cover"
                />
              ) : (
                <div className="h-32 w-32 rounded-lg bg-neutral-800" />
              )}
              <div className="min-w-0">
                <h2
                  className="truncate text-xl font-semibold"
                  data-testid="track-title"
                >
                  {track.title}
                </h2>
                <p
                  className="truncate text-sm text-neutral-400"
                  data-testid="track-artist"
                >
                  {track.artist}
                </p>
                <p className="mt-2 text-xs text-neutral-500">
                  {fmtDuration(track.durationMs)} · {track.sourceName}
                  {track.album ? ` · ${track.album}` : ""}
                  {track.isStream ? " · stream" : ""}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                data-testid="btn-play"
                onClick={() => {
                  engine.ensureAudioGraph();
                  void engine.play(track);
                }}
                className="rounded-lg bg-emerald-500 px-5 py-2 font-medium text-neutral-950 hover:bg-emerald-400"
              >
                {t("track:play")}
              </button>
              <button
                data-testid="btn-add-queue"
                onClick={() => {
                  void queueApi
                    .add([track.id])
                    .then(useQueueStore.getState().setQueueDto)
                    .then(() => show(t("track:added")))
                    .catch((err) => show(String((err as Error).message)));
                }}
                className="rounded-lg border border-neutral-700 px-5 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
              >
                {t("track:addToQueue")}
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="mx-auto w-full max-w-4xl px-6">
        <QueuePanel />
      </div>

      <PlayerBar onToast={show} />
    </main>
  );
}
