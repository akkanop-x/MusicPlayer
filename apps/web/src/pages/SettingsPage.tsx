/** SettingsPage — Phase 8 มี EQ ก่อน (frontend.md: SettingsPage = EQ + account + playback) */
import { Link } from "react-router";
import EqualizerPanel from "../components/eq/EqualizerPanel";
import PlayerBar from "../components/PlayerBar";

export default function SettingsPage() {
  return (
    <main className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold">ตั้งค่า</h1>
        <Link to="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← กลับ
        </Link>
      </header>

      <section className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-6 pb-40">
        <h2 className="text-sm font-medium text-neutral-300">Equalizer</h2>
        <EqualizerPanel />
      </section>

      <PlayerBar />
    </main>
  );
}
