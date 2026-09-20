/**
 * LibraryPage — tabs Playlists/Liked/History + EmptyState (ข้อมูลจริงเป็น Phase 10)
 */
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import LibraryPage from "./LibraryPage";
import "../i18n";

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/library" element={<LibraryPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("LibraryPage", () => {
  it("default tab = playlists + EmptyState", () => {
    renderAt("/library");
    expect(screen.getByTestId("library-empty-playlists")).toBeTruthy();
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
      "Playlist",
    );
  });

  it("สลับ tab ผ่าน ?tab=liked", () => {
    renderAt("/library?tab=liked");
    expect(screen.getByTestId("library-empty-liked")).toBeTruthy();
  });

  it("คลิก tab history → deep-link เปลี่ยน", () => {
    renderAt("/library");
    fireEvent.click(screen.getByTestId("library-tab-history"));
    expect(screen.getByTestId("location").textContent).toBe("/library?tab=history");
    expect(screen.getByTestId("library-empty-history")).toBeTruthy();
  });
});
