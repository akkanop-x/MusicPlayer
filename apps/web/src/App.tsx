import { useState, type FormEvent } from "react";

/** Login placeholder — Phase 1 (ยังไม่ต่อ auth จริง; AuthService เป็นงาน Phase 2+) */
export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // TODO(Phase 2+): POST /api/v1/auth/login
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-neutral-900 p-8 shadow-xl"
      >
        <h1 className="text-2xl font-semibold">MusicPlayer</h1>
        <p className="text-sm text-neutral-400">
          เข้าสู่ระบบ (placeholder — ฟีเจอร์จริงมาใน Phase ถัดไป)
        </p>
        <label className="block space-y-1">
          <span className="text-sm">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 outline-none focus:border-neutral-400"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">รหัสผ่าน</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 outline-none focus:border-neutral-400"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-lg bg-emerald-500 py-2 font-medium text-neutral-950 hover:bg-emerald-400"
        >
          เข้าสู่ระบบ
        </button>
      </form>
    </main>
  );
}
