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
import { usePlayerStore } from "./stores/playerStore";
import { applyLocaleFromServer } from "./i18n";
import {
  initMediaSession,
  updateMediaSessionMetadata,
  updateMediaSessionPlaybackState,
} from "./lib/mediaSession";
import "./i18n";
import AppShell from "./components/layout/AppShell";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import LibraryPage from "./pages/LibraryPage";
import PlaylistPage from "./pages/PlaylistPage";
import TrackPage from "./pages/TrackPage";
import SettingsPage from "./pages/SettingsPage";

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

function Shell() {
  // websocket.md — มี session แล้วเปิด socket (App เดียว ไม่ผูกกับ route → navigate ไม่หลุด);
  // token refresh → handshake ใหม่; logout/session หมด → ปิด
  const token = useAuthStore((s) => s.accessToken);
  // Media Session (frontend.md §8.1) — metadata ตาม track / playbackState ตาม state
  const track = usePlayerStore((s) => s.track);
  const playerState = usePlayerStore((s) => s.state);

  useEffect(() => {
    setRealtimeHandler(handleRealtimeEvent);
    initMediaSession();
    if (token) {
      connectRealtime();
      // boot: locale จาก user_settings (frontend.md §6.1) + EQ (equalizer.md §5)
      void applyLocaleFromServer();
      void (async () => {
        const { refreshEqFromServer } = await import("./stores/eqStore");
        await refreshEqFromServer();
      })();
    } else {
      disconnectRealtime();
    }
  }, [token]);

  useEffect(() => {
    updateMediaSessionMetadata(track);
  }, [track]);

  useEffect(() => {
    updateMediaSessionPlaybackState(playerState);
  }, [playerState]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* ทุกหน้าหลักอยู่ใต้ AppShell — PlayerBar layout-level (เสียงเล่นต่อข้ามหน้า) */}
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/playlist/:id" element={<PlaylistPage />} />
            <Route path="/track/:id" element={<TrackPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default function App() {
  return <Shell />;
}
