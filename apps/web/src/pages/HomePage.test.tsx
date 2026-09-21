/**
 * HomePage "แนะนำสำหรับคุณ" (Phase 12) — GET /recommendations → rows เล่นได้
 * (▶ = engine.play) + เริ่ม radio ได้ (📻 = engine.startRadio); cold start → empty state
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HomePage from "./HomePage";
import type { TrackDTO } from "@musicplayer/shared";

vi.mock("../api", () => ({
  authApi: { logout: vi.fn() },
  recommendationsApi: { list: vi.fn() },
}));

import { recommendationsApi } from "../api";
import { getAudioEngine, _resetEngineForTests } from "../lib/audioEngine";
import { usePlayerStore } from "../stores/playerStore";

const R1: TrackDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Rec One",
  artist: "Artist One",
  album: null,
  durationMs: 200_000,
  isStream: false,
  isSeekable: true,
  artworkUrl: null,
  sourceName: "youtube",
  isLiked: false,
};
const R2: TrackDTO = {
  ...R1,
  id: "22222222-2222-4222-8222-222222222222",
  title: "Rec Two",
};

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  _resetEngineForTests();
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
  vi.mocked(recommendationsApi.list).mockReset();
});

afterEach(() => {
  cleanup();
  usePlayerStore.setState({
    state: "IDLE",
    track: null,
    positionMs: 0,
    volume: 80,
    muted: false,
    repeatMode: "off",
    shuffle: false,
    autoplay: true,
    radio: false,
  });
});

describe("HomePage recommendations (Phase 12)", () => {
  it("แสดง rows จาก GET /recommendations", async () => {
    vi.mocked(recommendationsApi.list).mockResolvedValue({ tracks: [R1, R2] });
    renderHome();
    const rows = await screen.findAllByTestId("home-rec-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Rec One")).toBeTruthy();
  });

  it("กด ▶ → engine.play(track); กด 📻 → POST /radio/start (engine.startRadio)", async () => {
    vi.mocked(recommendationsApi.list).mockResolvedValue({ tracks: [R1] });
    const engine = getAudioEngine();
    const playSpy = vi.spyOn(engine, "play").mockResolvedValue(undefined);
    const radioSpy = vi.spyOn(engine, "startRadio").mockResolvedValue(undefined);
    renderHome();
    const row = await screen.findByTestId("home-rec-row");
    fireEvent.click(row.querySelector('[data-testid="home-rec-play"]')!);
    fireEvent.click(row.querySelector('[data-testid="home-rec-radio"]')!);
    await vi.waitFor(() => {
      expect(playSpy).toHaveBeenCalledWith(R1);
      expect(radioSpy).toHaveBeenCalledWith(R1);
    });
  });

  it("cold start (home feed ว่าง) → empty state แนะนำไปค้นหา/like", async () => {
    vi.mocked(recommendationsApi.list).mockResolvedValue({ tracks: [] });
    renderHome();
    expect(await screen.findByTestId("home-recs-empty")).toBeTruthy();
  });
});
