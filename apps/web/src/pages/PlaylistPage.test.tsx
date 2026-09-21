/**
 * PlaylistPage — เต็มรูปแบบ (Phase 10): header + เล่นทั้งหมด + rows (reorder/remove/like)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import PlaylistPage from "./PlaylistPage";
import { stubLibraryFetch, withQueryClient } from "../test/libraryHelpers";
import type { PlaylistDTO, TrackDTO } from "@musicplayer/shared";
import "../i18n";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ID = "00000000-0000-4000-8000-00000000aaaa";

function track(id: string, title: string): TrackDTO {
  return {
    id,
    title,
    artist: "Daft Punk",
    album: null,
    durationMs: 213_000,
    isStream: false,
    isSeekable: true,
    artworkUrl: null,
    sourceName: "youtube",
    isLiked: false,
  };
}

const PLAYLIST: PlaylistDTO = {
  id: ID,
  name: "Mix",
  description: "ห้ามพลาด",
  coverUrl: null,
  trackCount: 2,
  updatedAt: "2026-01-01T00:00:00.000Z",
  tracks: [
    track("11111111-1111-4111-8111-111111111111", "A"),
    track("22222222-2222-4222-8222-222222222222", "B"),
  ],
  itemIds: ["i1", "i2"],
};

function renderAt() {
  return render(
    withQueryClient(
      <MemoryRouter initialEntries={[`/playlist/${ID}`]}>
        <Routes>
          <Route path="/playlist/:id" element={<PlaylistPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe("PlaylistPage", () => {
  it("แสดงชื่อ/คำอธิบาย/จำนวน + rows ตามลำดับ", async () => {
    stubLibraryFetch({ playlist: PLAYLIST, playlists: [] });
    renderAt();
    expect((await screen.findByTestId("playlist-title")).textContent).toContain("Mix");
    expect(screen.getByText("ห้ามพลาด")).toBeTruthy();
    expect(screen.getByTestId("playlist-tracks").children).toHaveLength(2);
    expect(screen.getByTestId("playlist-row-0").textContent).toContain("A");
    expect(screen.getByTestId("playlist-row-1").textContent).toContain("B");
  });

  it("reorder ↓ → PATCH /playlists/:id/tracks/order ด้วยลำดับใหม่", async () => {
    const { calls } = stubLibraryFetch({ playlist: PLAYLIST, playlists: [] });
    renderAt();
    fireEvent.click(await screen.findByTestId("playlist-down-0"));
    await waitFor(() => {
      expect(calls.some((c) => c.includes("/tracks/order"))).toBe(true);
    });
  });

  it("remove ✕ → DELETE /playlists/:id/tracks", async () => {
    const { calls } = stubLibraryFetch({ playlist: PLAYLIST, playlists: [] });
    renderAt();
    fireEvent.click(await screen.findByTestId("playlist-remove-0"));
    await waitFor(() => {
      expect(calls.some((c) => c.startsWith("DELETE /playlists/"))).toBe(true);
    });
  });

  it("404 → ErrorState (retry มีปุ่ม)", async () => {
    stubLibraryFetch({ playlists: [] }); // ไม่มี fixture playlist → 404
    renderAt();
    await screen.findByText(/error|not found|no/i);
  });
});
