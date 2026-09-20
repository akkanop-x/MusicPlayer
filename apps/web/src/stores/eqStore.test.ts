/**
 * eqStore boot load (equalizer.md §5) — ดึง presets + settings → เติม store +
 * engine.applyEq ให้เสียงแรกมี EQ ถูกต้อง; ล้มเหลวเงียบ ๆ (Flat)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshEqFromServer, _resetEqStoreForTests, useEqStore } from "./eqStore";
import type { EqPresetDTO, UserSettingsDTO } from "@musicplayer/shared";

const { engineCalls, fakeEngine } = vi.hoisted(() => {
  const engineCalls: Array<{ fn: string; arg: unknown }> = [];
  const fakeEngine = {
    applyEq: (b: unknown) => engineCalls.push({ fn: "applyEq", arg: b }),
  };
  return { engineCalls, fakeEngine };
});

vi.mock("../lib/audioEngine", () => ({ getAudioEngine: () => fakeEngine }));

const apiMock = vi.hoisted(() => ({
  getPresets: vi.fn(),
  get: vi.fn(),
}));

vi.mock("../api", () => ({
  eqApi: { getPresets: apiMock.getPresets },
  settingsApi: apiMock,
}));

const BASS: EqPresetDTO = {
  id: "00000000-0000-4000-8000-000000000007",
  name: "Bass Boost",
  bands: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  isSystem: true,
};

const SETTINGS: UserSettingsDTO = {
  volume: 80,
  muted: false,
  autoplay: true,
  repeatMode: "off",
  shuffle: false,
  activeEqPresetId: BASS.id,
  locale: "th",
};

beforeEach(() => {
  _resetEqStoreForTests();
  engineCalls.length = 0;
  apiMock.getPresets.mockReset();
  apiMock.get.mockReset();
});

describe("refreshEqFromServer (boot)", () => {
  it("มี active preset → store ครบ + engine.applyEq ด้วย bands ของ preset", async () => {
    apiMock.getPresets.mockResolvedValue({ presets: [BASS] });
    apiMock.get.mockResolvedValue(SETTINGS);

    await refreshEqFromServer();

    const state = useEqStore.getState();
    expect(state.presets).toEqual([BASS]);
    expect(state.activePresetId).toBe(BASS.id);
    expect(state.activeBands).toEqual(BASS.bands);
    expect(engineCalls).toEqual([{ fn: "applyEq", arg: BASS.bands }]);
  });

  it("activeEqPresetId null (Flat) → activeBands null + applyEq(null)", async () => {
    apiMock.getPresets.mockResolvedValue({ presets: [BASS] });
    apiMock.get.mockResolvedValue({ ...SETTINGS, activeEqPresetId: null });

    await refreshEqFromServer();

    expect(useEqStore.getState().activePresetId).toBeNull();
    expect(useEqStore.getState().activeBands).toBeNull();
    expect(engineCalls).toEqual([{ fn: "applyEq", arg: null }]);
  });

  it("active preset ไม่อยู่ใน list (ถูกลบ) → ถือว่า Flat", async () => {
    apiMock.getPresets.mockResolvedValue({ presets: [] });
    apiMock.get.mockResolvedValue(SETTINGS);

    await refreshEqFromServer();

    expect(useEqStore.getState().activeBands).toBeNull();
    expect(engineCalls).toEqual([{ fn: "applyEq", arg: null }]);
  });

  it("API ล้มเหลว → เงียบ ๆ คง Flat (ไม่ throw)", async () => {
    apiMock.getPresets.mockRejectedValue(new Error("401"));
    await expect(refreshEqFromServer()).resolves.toBeUndefined();
    expect(useEqStore.getState().activeBands).toBeNull();
  });
});
