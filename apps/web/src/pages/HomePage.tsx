/** HomePage — greeting ตามเวลา + "แนะนำสำหรับคุณ" (Phase 12) + shortcut + คิวปัจจุบัน */
import { useEffect } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { getAudioEngine } from "../lib/audioEngine";
import { usePlayerStore, useQueueStore } from "../stores/playerStore";
import { authApi, recommendationsApi } from "../api";
import type { TrackDTO } from "@musicplayer/shared";

function greetingKey(hour: number): string {
  if (hour < 5) return "home:greetingNight";
  if (hour < 12) return "home:greetingMorning";
  if (hour < 17) return "home:greetingAfternoon";
  if (hour < 22) return "home:greetingEvening";
  return "home:greetingNight";
}

const CARDS = [
  {
    to: "/search",
    testId: "card-search",
    titleKey: "home:searchCta",
    descKey: "home:searchCtaDesc",
    icon: "🔍",
  },
  {
    to: "/library",
    testId: "card-library",
    titleKey: "home:libraryCta",
    descKey: "home:libraryCtaDesc",
    icon: "📚",
  },
  {
    to: "/settings",
    testId: "card-settings",
    titleKey: "home:settingsCta",
    descKey: "home:settingsCtaDesc",
    icon: "⚙️",
  },
] as const;

/** "แนะนำสำหรับคุณ" — home feed จาก GET /recommendations (เล่นได้ + เริ่ม radio ได้) */
function RecommendationsSection() {
  const { t } = useTranslation();
  const engine = getAudioEngine();
  const { data } = useQuery({
    queryKey: ["recommendations"],
    queryFn: () => recommendationsApi.list(10),
  });
  const tracks = data?.tracks ?? [];

  // §7 cold start — ไม่มี like/history → empty state แนะนำให้ค้นหา/like ก่อน
  if (tracks.length === 0) {
    return (
      <section className="mt-8" data-testid="home-recs-empty">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {t("home:recommended")}
        </h2>
        <p className="mt-3 text-sm text-neutral-500">{t("home:recommendedEmpty")}</p>
      </section>
    );
  }

  const play = (track: TrackDTO) => void engine.play(track);
  const radio = (track: TrackDTO) => void engine.startRadio(track);

  return (
    <section className="mt-8" data-testid="home-recs">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
        {t("home:recommended")}
      </h2>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tracks.map((track) => (
          <li
            key={track.id}
            data-testid="home-rec-row"
            className="flex items-center gap-3 rounded-xl bg-neutral-900 p-3"
          >
            {track.artworkUrl ? (
              <img
                src={track.artworkUrl}
                alt=""
                className="h-12 w-12 rounded-lg object-cover"
              />
            ) : (
              <div className="h-12 w-12 rounded-lg bg-neutral-800" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{track.title}</span>
              <span className="block truncate text-xs text-neutral-400">
                {track.artist}
              </span>
            </span>
            <button
              data-testid="home-rec-play"
              aria-label={`${t("home:recPlay")}: ${track.title}`}
              onClick={() => play(track)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              ▶
            </button>
            <button
              data-testid="home-rec-radio"
              aria-label={`${t("home:recRadio")}: ${track.title}`}
              onClick={() => radio(track)}
              className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
            >
              📻
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function HomePage() {
  const { t } = useTranslation();
  const engine = getAudioEngine();
  const { track, state } = usePlayerStore();
  const { current, upcoming } = useQueueStore();
  const shown = track ?? current?.track ?? null;

  // boot: ดึง player+queue state จาก server (restore snapshot หลัง refresh — player.md #7)
  useEffect(() => {
    void engine.syncFromServer();
  }, [engine]);

  return (
    <div className="px-6 py-6">
      <header className="flex items-center justify-between">
        <h1 data-testid="greeting" className="text-2xl font-semibold">
          {t(greetingKey(new Date().getHours()))}
        </h1>
        <button
          onClick={() => {
            void authApi.logout().finally(() => window.location.assign("/login"));
          }}
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          {t("common:logout")}
        </button>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CARDS.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            data-testid={card.testId}
            className="flex items-center gap-4 rounded-xl bg-neutral-900 p-5 transition hover:bg-neutral-800"
          >
            <span aria-hidden className="text-2xl">
              {card.icon}
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{t(card.titleKey)}</span>
              <span className="block truncate text-xs text-neutral-400">
                {t(card.descKey)}
              </span>
            </span>
          </Link>
        ))}
      </section>

      <RecommendationsSection />

      <section className="mt-8" data-testid="home-queue">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {t("home:queueSummary")}
        </h2>
        {shown ? (
          <button
            onClick={() => engine.ensureAudioGraph()}
            className="mt-3 flex w-full items-center gap-4 rounded-xl bg-gradient-to-r from-emerald-900/60 to-neutral-900 p-5 text-left"
          >
            {shown.artworkUrl ? (
              <img
                src={shown.artworkUrl}
                alt=""
                className="h-16 w-16 rounded-lg object-cover"
              />
            ) : (
              <div className="h-16 w-16 rounded-lg bg-neutral-800" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{shown.title}</span>
              <span className="block truncate text-sm text-neutral-400">
                {shown.artist}
              </span>
            </span>
            <span className="text-sm text-emerald-300">
              {state === "PLAYING" ? "▶" : state === "IDLE" ? "" : "⏸"}
              {t("home:queueUpcoming", { count: upcoming.length })}
            </span>
          </button>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">{t("home:queueEmpty")}</p>
        )}
      </section>
    </div>
  );
}
