/** LibraryPage — tabs Playlists/Liked/History (frontend.md §1) — ข้อมูลจริงมาใน Phase 10 */
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import EmptyState from "../components/ui/EmptyState";

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

const EMPTY_BY_TAB: Record<
  TabKey,
  { icon: string; titleKey: string; descKey: string }
> = {
  playlists: {
    icon: "📁",
    titleKey: "library:emptyPlaylistsTitle",
    descKey: "library:emptyPlaylistsDesc",
  },
  liked: {
    icon: "💚",
    titleKey: "library:emptyLikedTitle",
    descKey: "library:emptyLikedDesc",
  },
  history: {
    icon: "🕐",
    titleKey: "library:emptyHistoryTitle",
    descKey: "library:emptyHistoryDesc",
  },
};

export default function LibraryPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const active =
    TABS.find((tab) => tab.key === tabParam)?.key ?? ("playlists" as const);
  const empty = EMPTY_BY_TAB[active];

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
        <EmptyState
          icon={empty.icon}
          title={t(empty.titleKey)}
          description={t(empty.descKey)}
          testId={`library-empty-${active}`}
          action={
            <Link
              to="/search"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400"
            >
              {t("common:nav.search")}
            </Link>
          }
        />
        <p className="mt-3 text-center text-xs text-neutral-600">
          {t("library:comingSoon")}
        </p>
      </div>
    </div>
  );
}
