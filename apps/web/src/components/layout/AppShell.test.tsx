/**
 * AppShell — frontend.md §5: nav ครบ 4 หน้า + navigate ได้ (PlayerBar อยู่ layout-level)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import AppShell from "./AppShell";
import LibraryPage from "../../pages/LibraryPage";
import HomePage from "../../pages/HomePage";
import { stubLibraryFetch, withQueryClient } from "../../test/libraryHelpers";
import "../../i18n";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppShell", () => {
  // AppShell ใช้ <Outlet> — routes ซ้อนอยู่ใต้ shell เหมือนใน App.tsx
  function renderShell(initial: string) {
    stubLibraryFetch();
    return render(
      withQueryClient(
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/library" element={<LibraryPage />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      ),
    );
  }

  it("nav ครบ 4 หน้า + เนื้อหาแสดง (sidebar + mobile nav ซ้ำตำแหน่งละ 1)", () => {
    renderShell("/");
    for (const id of ["nav-home", "nav-search", "nav-library", "nav-settings"]) {
      expect(screen.getAllByTestId(id).length).toBe(2);
    }
    expect(screen.getByTestId("greeting")).toBeTruthy();
  });

  it("คลิก nav ไป Library แล้วเห็น tabs", async () => {
    renderShell("/");
    fireEvent.click(screen.getAllByTestId("nav-library")[0]!);
    expect(screen.getByTestId("library-tab-playlists")).toBeTruthy();
    expect(await screen.findByTestId("library-empty-playlists")).toBeTruthy();
  });
});
