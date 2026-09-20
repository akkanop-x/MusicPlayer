/**
 * AppShell — frontend.md §5: layout ระดับแอป — sidebar (desktop) / bottom nav (mobile);
 * PlayerBar+NowPlaying เป็น layout-level ไม่ unmount ตอนเปลี่ยนหน้า (เสียงเล่นต่อ)
 */
import { NavLink, Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import PlayerBar from "../PlayerBar";
import QueuePanel from "../QueuePanel";
import NowPlayingView from "../player/NowPlayingView";
import { useToastStore } from "../../stores/playerStore";
import { useEffect } from "react";

const NAV_ITEMS = [
  { to: "/", key: "common:nav.home", icon: "🏠", testId: "nav-home" },
  { to: "/search", key: "common:nav.search", icon: "🔍", testId: "nav-search" },
  { to: "/library", key: "common:nav.library", icon: "📚", testId: "nav-library" },
  { to: "/settings", key: "common:nav.settings", icon: "⚙️", testId: "nav-settings" },
] as const;

function NavLinks({ vertical }: { vertical: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          data-testid={item.testId}
          className={
            vertical
              ? "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100 aria-[current=page]:bg-neutral-800/80 aria-[current=page]:text-emerald-400"
              : "flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] text-neutral-400 aria-[current=page]:text-emerald-400"
          }
        >
          <span aria-hidden className={vertical ? "text-base" : "text-lg"}>
            {item.icon}
          </span>
          {t(item.key)}
        </NavLink>
      ))}
    </>
  );
}

function Toast() {
  const message = useToastStore((s) => s.message);
  const hide = useToastStore((s) => s.hide);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(hide, 4_000);
    return () => clearTimeout(t);
  }, [message, hide]);
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="toast"
      className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-red-500/90 px-4 py-2 text-sm text-white shadow-lg"
    >
      {message}
    </div>
  );
}

export default function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* sidebar — desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col gap-6 border-r border-neutral-900 bg-neutral-950/95 px-4 py-6 md:flex">
        <NavLink to="/" className="px-3 text-lg font-semibold">
          MusicPlayer
        </NavLink>
        <nav className="flex flex-col gap-1" aria-label={t("common:nav.home")}>
          <NavLinks vertical />
        </nav>
      </aside>

      {/* main — เผื่อซ้ายให้ sidebar (desktop) / ล่างให้ nav+PlayerBar (mobile) */}
      <main className="mx-auto w-full max-w-4xl px-6 md:pl-56">
        <Outlet />
        <QueuePanel />
        {/* spacer ให้เนื้อหาไม่โดน bottom nav + PlayerBar ทับ */}
        <div className="h-64 md:h-32" aria-hidden />
      </main>

      {/* bottom nav — mobile (อยู่เหนือ PlayerBar) */}
      <nav
        aria-label="main"
        className="fixed inset-x-0 bottom-[76px] z-30 flex items-center justify-around border-t border-neutral-900 bg-neutral-950/95 py-1 backdrop-blur md:hidden"
      >
        <NavLinks vertical={false} />
      </nav>

      {/* layout-level — เปลี่ยนหน้าแล้วยังอยู่ */}
      <PlayerBar />
      <NowPlayingView />
      <Toast />
    </div>
  );
}
