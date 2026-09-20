/** SettingsPage — ภาษา + บัญชี + EQ (frontend.md §1: EQ, account, playback preferences) */
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import EqualizerPanel from "../components/eq/EqualizerPanel";
import { authApi } from "../api";
import { LOCALES, type Locale } from "../i18n";
import { applyLocale, useSetLocale } from "../hooks/useSettings";

const LOCALE_LABELS: Record<Locale, string> = {
  th: "settings:languageTh",
  en: "settings:languageEn",
};

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const setLocale = useSetLocale();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => authApi.me(),
    staleTime: 60_000,
    retry: false,
  });

  const currentLocale = (LOCALES as readonly string[]).includes(i18n.language)
    ? (i18n.language as Locale)
    : "th";

  return (
    <div className="px-6 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("settings:title")}</h1>
        <Link to="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          {t("common:back")}
        </Link>
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-10">
        <section data-testid="settings-language">
          <h2 className="text-sm font-medium text-neutral-300">
            {t("settings:sectionLanguage")}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">{t("settings:languageDesc")}</p>
          <div className="mt-3 flex gap-2">
            {LOCALES.map((locale) => (
              <button
                key={locale}
                data-testid={`lang-${locale}`}
                aria-pressed={currentLocale === locale}
                onClick={() => {
                  setLocale.mutate(locale);
                  applyLocale(locale); // optimistic — REST confirm ตามมา
                }}
                className={`rounded-lg px-4 py-2 text-sm ${
                  currentLocale === locale
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "border border-neutral-700 text-neutral-300 hover:bg-neutral-900"
                }`}
              >
                {t(LOCALE_LABELS[locale])}
              </button>
            ))}
          </div>
        </section>

        <section data-testid="settings-account">
          <h2 className="text-sm font-medium text-neutral-300">
            {t("settings:sectionAccount")}
          </h2>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-neutral-900 px-4 py-3">
            <span
              className="min-w-0 truncate text-sm text-neutral-300"
              data-testid="account-email"
            >
              {t("settings:loggedInAs")}
              {meQuery.data ? `: ${meQuery.data.email}` : ""}
            </span>
            <button
              onClick={() => {
                void authApi.logout().finally(() => window.location.assign("/login"));
              }}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              {t("common:logout")}
            </button>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-neutral-300">
            {t("settings:sectionEq")}
          </h2>
          <div className="mt-3">
            <EqualizerPanel />
          </div>
        </section>
      </div>
    </div>
  );
}
