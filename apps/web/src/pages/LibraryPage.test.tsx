/**
 * LibraryPage — tabs Playlists/Liked/History ข้อมูลจริง (Phase 10)
 * + EmptyState เมื่อ API ว่าง + สร้าง playlist + like ผ่าน LikeButton
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import LibraryPage from "./LibraryPage";
import { stubLibraryFetch, withQueryClient } from "../test/libraryHelpers";
import type { TrackDTO } from "@musicplayer/shared";
import "../i18n";

afterEach(() => {
  vi.unstubAllGlobals();
});

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}

function renderAt(entry: string) {
  return render(
    withQueryClient(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/library" element={<LibraryPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    ),
  );
}

const TRACK: TrackDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "One More Time",
  artist: "Daft Punk",
  album: null,
  durationMs: 213_000,
  isStream: false,
  isSeekable: true,
  artworkUrl: null,
  sourceName: "youtube",
  isLiked: true,
};

describe("LibraryPage", () => {
  it("default tab = playlists + EmptyState (API ว่าง)", async () => {
    stubLibraryFetch();
    renderAt("/library");
    expect(await screen.findByTestId("library-empty-playlists")).toBeTruthy();
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
      "Playlist",
    );
  });

  it("สลับ tab ผ่าน ?tab=liked — มีข้อมูล → รายการเพลง + heart ติด", async () => {
    stubLibraryFetch({
      playlists: [],
      likes: {
        items: [{ track: TRACK, likedAt: "2026-01-01T00:00:00.000Z" }],
        nextCursor: null,
      },
      history: { items: [], nextCursor: null },
    });
    renderAt("/library?tab=liked");
    const row = await screen.findByTestId(`library-play-${TRACK.id}`);
    expect(row).toBeTruthy();
    const heart = screen.getByTestId(`like-${TRACK.id}`);
    // ["likes","ids"] query โหลดตามหลัง list query ได้ — รอ optimistic cache เต็ม
    await waitFor(() => expect(heart.getAttribute("aria-pressed")).toBe("true"));
  });

  it("คลิก tab history → deep-link เปลี่ยน + EmptyState", async () => {
    stubLibraryFetch();
    renderAt("/library");
    fireEvent.click(await screen.findByTestId("library-tab-history"));
    expect(screen.getByTestId("location").textContent).toBe("/library?tab=history");
    expect(await screen.findByTestId("library-empty-history")).toBeTruthy();
  });

  it("history — กลุ่มตามวัน (วันนี้) + tag skipped/ฟังจบ", async () => {
    const now = Date.now();
    stubLibraryFetch({
      playlists: [],
      likes: { items: [], nextCursor: null },
      history: {
        items: [
          {
            id: "h1",
            track: { ...TRACK, isLiked: false },
            playedAt: new Date(now).toISOString(),
            msPlayed: 31_000,
            completed: false,
            skipped: true,
          },
          {
            id: "h2",
            track: { ...TRACK, id: "22222222-2222-4222-8222-222222222222" },
            playedAt: new Date(now).toISOString(),
            msPlayed: 213_000,
            completed: true,
            skipped: false,
          },
        ],
        nextCursor: null,
      },
    });
    renderAt("/library?tab=history");
    await screen.findByTestId("history-list");
    expect(screen.getAllByTestId("history-day")[0]!.textContent).toBe("วันนี้");
    expect(screen.getAllByTestId("history-skipped")).toHaveLength(1);
  });

  it("พิมพ์ชื่อแล้วกดสร้าง → POST /playlists", async () => {
    const { calls } = stubLibraryFetch();
    renderAt("/library");
    const input = await screen.findByTestId("library-new-playlist-name");
    fireEvent.input(input, { target: { value: "My Mix" } });
    fireEvent.click(screen.getByTestId("library-create-playlist"));
    await waitFor(() => {
      expect(calls.some((c) => c.startsWith("POST /playlists"))).toBe(true);
    });
  });
});
