/**
 * PlayerBar autoplay toggle (Phase 11) — กดแล้ว optimistic + PATCH /settings,
 * ปิดตอน error rollback; สถานะปุ่มตาม store.autoplay
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PlayerBar from "./PlayerBar";
import { usePlayerStore } from "../stores/playerStore";
import { _resetEngineForTests } from "../lib/audioEngine";
import "../i18n";

function patchCalls(): string[] {
  return (window as unknown as { __patches?: string[] }).__patches ?? [];
}

function stubFetch() {
  const calls: string[] = [];
  (window as unknown as { __patches?: string[] }).__patches = calls;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace(/^(https?:\/\/[^/]+)?\/api\/v1/, "");
      if (url === "/settings" && init?.method === "PATCH") {
        calls.push(url);
        return new Response(
          JSON.stringify({
            volume: 80,
            muted: false,
            locale: "th",
            activeEqPresetId: null,
            autoplay: JSON.parse(String(init.body)).autoplay,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ message: "not found" }), {
        status: 404,
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  _resetEngineForTests();
  usePlayerStore.setState({
    state: "IDLE",
    track: null,
    positionMs: 0,
    volume: 80,
    muted: false,
    repeatMode: "off",
    shuffle: false,
    autoplay: true,
  });
});

describe("PlayerBar autoplay toggle (Phase 11)", () => {
  it("กดปุ่ม → aria-pressed สลับทันที (optimistic) + PATCH /settings ถูกยิง", async () => {
    stubFetch();
    render(<PlayerBar />);
    const btn = screen.getByTestId("btn-autoplay");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(patchCalls()).toEqual(["/settings"]));
    await waitFor(() => expect(usePlayerStore.getState().autoplay).toBe(false));
  });

  it("PATCH ล้มเหลว → rollback สถานะปุ่มกลับเป็นเดิม", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    render(<PlayerBar />);
    const btn = screen.getByTestId("btn-autoplay");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(usePlayerStore.getState().autoplay).toBe(true));
  });
});
