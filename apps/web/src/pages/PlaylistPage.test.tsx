/**
 * PlaylistPage — /playlist/:id placeholder (PlaylistService เป็น Phase 10)
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import PlaylistPage from "./PlaylistPage";
import "../i18n";

describe("PlaylistPage", () => {
  it("แสดง placeholder + id", () => {
    render(
      <MemoryRouter initialEntries={["/playlist/abc-123"]}>
        <Routes>
          <Route path="/playlist/:id" element={<PlaylistPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("playlist-placeholder")).toBeTruthy();
    expect(screen.getByTestId("playlist-id").textContent).toContain("abc-123");
  });
});
