/**
 * LikeButton — optimistic heart (useLikedIds cache + PUT/DELETE like)
 * LIKES_CHANGED จากอุปกรณ์อื่นต้องทำให้ heart sync ด้วย (handlers.test ครอบฝั่ง WS)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LikeButton from "./LikeButton";
import { stubLibraryFetch, withQueryClient } from "../test/libraryHelpers";
import type { TrackDTO } from "@musicplayer/shared";
import "../i18n";

afterEach(() => {
  vi.unstubAllGlobals();
});

const TRACK: TrackDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "T",
  artist: "A",
  album: null,
  durationMs: 1_000,
  isStream: false,
  isSeekable: true,
  artworkUrl: null,
  sourceName: "youtube",
  isLiked: false,
};

describe("LikeButton", () => {
  it("ยังไม่ like → กดแล้วเป็น pressed ทันที (optimistic) + ยิง PUT", async () => {
    const { calls } = stubLibraryFetch({
      likes: { items: [], nextCursor: null },
    });
    render(withQueryClient(<LikeButton trackId={TRACK.id} />));
    const heart = await screen.findByTestId(`like-${TRACK.id}`);
    expect(heart.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(heart);
    await waitFor(() => {
      expect(heart.getAttribute("aria-pressed")).toBe("true");
      expect(calls).toContain("PUT /tracks/11111111-1111-4111-8111-111111111111/like");
    });
  });

  it("like อยู่แล้ว → กดเพื่อ unlike (DELETE)", async () => {
    const { calls } = stubLibraryFetch({
      likes: {
        items: [
          { track: { ...TRACK, isLiked: true }, likedAt: "2026-01-01T00:00:00.000Z" },
        ],
        nextCursor: null,
      },
    });
    render(withQueryClient(<LikeButton trackId={TRACK.id} />));
    const heart = await screen.findByTestId(`like-${TRACK.id}`);
    await waitFor(() => expect(heart.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(heart);
    await waitFor(() => {
      expect(calls).toContain(
        "DELETE /tracks/11111111-1111-4111-8111-111111111111/like",
      );
    });
  });
});
