import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hydrateSession } from "./api";
import { handleRealtimeEvent } from "./realtime/handlers";
import {
  connectRealtime,
  disconnectRealtime,
  setRealtimeHandler,
} from "./realtime/socketClient";
import { useAuthStore } from "./stores/authStore";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import TrackPage from "./pages/TrackPage";
import { useToastStore } from "./stores/playerStore";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/** guard ให้หน้าหลักใช้ได้เมื่อมี access token (หรือ refresh สำเร็จ) */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!useAuthStore.getState().accessToken) {
        const ok = await hydrateSession();
        if (!ok && !cancelled) useAuthStore.getState().clear();
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!token) {
    return ready ? <Navigate to="/login" replace /> : null;
  }
  return <>{children}</>;
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
      className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-lg bg-red-500/90 px-4 py-2 text-sm text-white shadow-lg"
    >
      {message}
    </div>
  );
}

export default function App() {
  // websocket.md — มี session แล้วเปิด socket (App เดียว ไม่ผูกกับ route → navigate ไม่หลุด);
  // token refresh → handshake ใหม่; logout/session หมด → ปิด
  const token = useAuthStore((s) => s.accessToken);
  useEffect(() => {
    setRealtimeHandler(handleRealtimeEvent);
    if (token) connectRealtime();
    else disconnectRealtime();
  }, [token]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <HomePage />
              </RequireAuth>
            }
          />
          <Route
            path="/track/:id"
            element={
              <RequireAuth>
                <TrackPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toast />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
