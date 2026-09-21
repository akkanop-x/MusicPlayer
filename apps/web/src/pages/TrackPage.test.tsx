/**
 * TrackPage — roadmap Phase 6 "Track page/detail": โหลดด้วย /tracks/:id, ปุ่ม play/add-to-queue
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TrackPage from "./TrackPage";
import type { PlayerStateDTO, TrackDTO } from "@musicplayer/shared";

vi.mock("../api", () => ({
  tracksApi: { getById: vi.fn() },
  queueApi: { add: vi.fn() },
  playerApi: { play: vi.fn() },
}));

import { tracksApi, queueApi, playerApi } from "../api";

const TRACK: TrackDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Never Gonna Give You Up",
  artist: "Rick Astley",
  album: null,
  durationMs: 213_000,
  isStream: false,
  isSeekable: true,
  artworkUrl: null,
  sourceName: "youtube",
  isLiked: false,
};

const STATE: PlayerStateDTO = {
  state: "PLAYING",
  track: TRACK,
  positionMs: 0,
  volume: 80,
  muted: false,
  repeatMode: "off",
  shuffle: false,
  autoplay: true,
  radio: false,
};

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/track/:id" element={<TrackPage />} />
          <Route path="*" element={<p>not found route</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // jsdom ไม่มี media pipeline — stub ตาม audioEngine.test
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
  vi.mocked(tracksApi.getById).mockReset();
  vi.mocked(queueApi.add).mockReset();
  vi.mocked(playerApi.play).mockReset();
});

describe("TrackPage", () => {
  it("โหลด /tracks/:id → แสดง title/artist/source", async () => {
    vi.mocked(tracksApi.getById).mockResolvedValue(TRACK);
    renderAt(`/track/${TRACK.id}`);

    await screen.findByTestId("track-detail");
    expect(screen.getByTestId("track-title").textContent).toBe(TRACK.title);
    expect(screen.getByTestId("track-artist").textContent).toBe(TRACK.artist);
    expect(screen.getByText(/3:33 · youtube/)).toBeTruthy();
  });

  it("กด play → playerApi.play(trackId) ถูกเรียก", async () => {
    vi.mocked(tracksApi.getById).mockResolvedValue(TRACK);
    vi.mocked(playerApi.play).mockResolvedValue(STATE);
    renderAt(`/track/${TRACK.id}`);

    const btn = await screen.findByTestId("btn-play");
    btn.click();
    await vi.waitFor(() => expect(playerApi.play).toHaveBeenCalledWith(TRACK.id));
  });

  it("กด add-to-queue → queueApi.add([trackId]) ถูกเรียก + toast", async () => {
    vi.mocked(tracksApi.getById).mockResolvedValue(TRACK);
    vi.mocked(queueApi.add).mockResolvedValue({
      current: null,
      upcoming: [],
      history: [],
      version: 1,
    });
    renderAt(`/track/${TRACK.id}`);

    const btn = await screen.findByTestId("btn-add-queue");
    btn.click();
    await vi.waitFor(() => expect(queueApi.add).toHaveBeenCalledWith([TRACK.id]));
  });

  it("404 (TRACK_NOT_FOUND) → แสดงข้อความไม่พบเพลง", async () => {
    vi.mocked(tracksApi.getById).mockRejectedValue(new Error("Track not found"));
    renderAt(`/track/${TRACK.id}`);
    await screen.findByText("ไม่พบเพลงนี้ในระบบ");
  });
});
