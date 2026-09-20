import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { authApi, hydrateSession } from "../api";
import { useAuthStore } from "../stores/authStore";

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);

  // เซสชันเดิม (refresh cookie) ยังอยู่ → เข้าหน้าหลักเลย
  useEffect(() => {
    void hydrateSession().then((ok) => {
      if (ok) navigate("/", { replace: true });
    });
  }, [navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "login"
          ? await authApi.login(email, password)
          : await authApi.register(email, password, displayName || undefined);
      setAccessToken(result.accessToken);
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-neutral-900 p-8 shadow-xl"
      >
        <h1 className="text-2xl font-semibold">MusicPlayer</h1>
        <p className="text-sm text-neutral-400">
          {mode === "login" ? t("auth:login") : t("auth:register")}
        </p>
        {mode === "register" && (
          <label className="block space-y-1">
            <span className="text-sm">{t("auth:displayName")}</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 outline-none focus:border-neutral-400"
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-sm">{t("auth:email")}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 outline-none focus:border-neutral-400"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">{t("auth:password")}</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 outline-none focus:border-neutral-400"
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-emerald-500 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy
            ? t("auth:submitting")
            : mode === "login"
              ? t("auth:submitLogin")
              : t("auth:submitRegister")}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="w-full text-sm text-neutral-400 hover:text-neutral-200"
        >
          {mode === "login" ? t("auth:toRegister") : t("auth:toLogin")}
        </button>
      </form>
    </main>
  );
}
