/**
 * EqualizerPanel — ลาก slider → engine.applyEq ทันที; เลือก preset → apply local +
 * PUT /eq/active; บันทึก/ลบ custom preset; boot load อยู่ที่ stores/eqStore.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EqualizerPanel from "./EqualizerPanel";
import { _resetEqStoreForTests, useEqStore } from "../../stores/eqStore";
import { useToastStore } from "../../stores/playerStore";
import type { EqPresetDTO } from "@musicplayer/shared";

const { engineCalls, fakeEngine } = vi.hoisted(() => {
  const engineCalls: Array<{ fn: string; arg: unknown }> = [];
  const fakeEngine = {
    applyEq: (b: unknown) => engineCalls.push({ fn: "applyEq", arg: b }),
  };
  return { engineCalls, fakeEngine };
});

vi.mock("../../lib/audioEngine", () => ({ getAudioEngine: () => fakeEngine }));

const apiMock = vi.hoisted(() => ({
  getPresets: vi.fn(),
  createPreset: vi.fn(),
  updatePreset: vi.fn(),
  deletePreset: vi.fn(),
  setActive: vi.fn(),
}));

vi.mock("../../api", () => ({ eqApi: apiMock }));

const FLAT: EqPresetDTO = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Flat",
  bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  isSystem: true,
};
const BASS: EqPresetDTO = {
  id: "00000000-0000-4000-8000-000000000007",
  name: "Bass Boost",
  bands: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  isSystem: true,
};

beforeEach(() => {
  _resetEqStoreForTests();
  engineCalls.length = 0;
  apiMock.setActive.mockReset();
  apiMock.createPreset.mockReset();
  apiMock.deletePreset.mockReset();
  useToastStore.setState({ message: null });
  vi.restoreAllMocks();
});

function seedStore() {
  useEqStore.getState().setPresets([FLAT, BASS]);
  useEqStore.getState().setActive(BASS.id, BASS.bands);
}

describe("EqualizerPanel", () => {
  it("render 10 sliders + presets — ค่าตรง activeBands", () => {
    seedStore();
    render(<EqualizerPanel />);
    for (let i = 0; i < 10; i += 1) {
      const slider = screen.getByTestId(`eq-band-${i}`) as HTMLInputElement;
      expect(Number(slider.value)).toBe(BASS.bands[i]);
    }
    const select = screen.getByTestId("eq-preset-select") as HTMLSelectElement;
    expect(select.value).toBe(BASS.id);
  });

  it("ลาก slider → engine.applyEq ทันทีด้วย bands ใหม่ (เฉพาะ band ที่เลื่อน)", () => {
    seedStore();
    render(<EqualizerPanel />);
    fireEvent.change(screen.getByTestId("eq-band-0"), { target: { value: "-6" } });
    expect(engineCalls).toHaveLength(1);
    expect(engineCalls[0]!.arg).toEqual([-6, 6, 4, 2, 0, 0, 0, 0, 0, 0]);
    expect(useEqStore.getState().draftBands![0]).toBe(-6);
  });

  it("เลือก preset → applyEq local ก่อน แล้วยิง PUT /eq/active", async () => {
    seedStore();
    apiMock.setActive.mockResolvedValue({ activeEqPresetId: FLAT.id });
    render(<EqualizerPanel />);
    fireEvent.change(screen.getByTestId("eq-preset-select"), { target: { value: "" } });
    // local apply ทันที (null = flat)
    expect(engineCalls[0]).toEqual({ fn: "applyEq", arg: null });
    // await REST
    await vi.waitFor(() => expect(apiMock.setActive).toHaveBeenCalledWith(null));
  });

  it("เลือก preset จาก list → PUT ด้วย presetId นั้น", async () => {
    seedStore();
    useEqStore.getState().setActive(FLAT.id, null);
    apiMock.setActive.mockResolvedValue({ activeEqPresetId: BASS.id });
    render(<EqualizerPanel />);
    fireEvent.change(screen.getByTestId("eq-preset-select"), {
      target: { value: BASS.id },
    });
    expect(engineCalls[0]!.arg).toEqual(BASS.bands);
    await vi.waitFor(() => expect(apiMock.setActive).toHaveBeenCalledWith(BASS.id));
  });

  it("บันทึก draft เป็น custom preset → POST + setActive + ได้ EQ จาก preset ใหม่", async () => {
    seedStore();
    render(<EqualizerPanel />);
    fireEvent.change(screen.getByTestId("eq-band-3"), { target: { value: "5" } });
    const prompt = vi.fn(() => "ของฉัน");
    vi.stubGlobal("prompt", prompt);
    apiMock.createPreset.mockResolvedValue({
      id: "custom-1",
      name: "ของฉัน",
      bands: [8, 6, 4, 5, 0, 0, 0, 0, 0, 0],
      isSystem: false,
    });
    apiMock.setActive.mockResolvedValue({ activeEqPresetId: "custom-1" });

    fireEvent.click(screen.getByTestId("eq-save"));

    await vi.waitFor(() =>
      expect(apiMock.createPreset).toHaveBeenCalledWith(
        "ของฉัน",
        [8, 6, 4, 5, 0, 0, 0, 0, 0, 0],
      ),
    );
    await vi.waitFor(() => expect(apiMock.setActive).toHaveBeenCalledWith("custom-1"));
    expect(useEqStore.getState().presets.find((p) => p.id === "custom-1")).toBeTruthy();
  });

  it("ลบ custom preset ที่ active → DELETE + กลับเป็น Flat", async () => {
    const custom: EqPresetDTO = {
      ...BASS,
      id: "custom-1",
      name: "ของฉัน",
      isSystem: false,
    };
    useEqStore.getState().setPresets([FLAT, custom]);
    useEqStore.getState().setActive(custom.id, custom.bands);
    apiMock.deletePreset.mockResolvedValue(undefined);
    render(<EqualizerPanel />);

    fireEvent.click(screen.getByTestId("eq-delete"));

    await vi.waitFor(() =>
      expect(apiMock.deletePreset).toHaveBeenCalledWith("custom-1"),
    );
    expect(useEqStore.getState().activePresetId).toBeNull();
    expect(useEqStore.getState().activeBands).toBeNull();
    expect(engineCalls.at(-1)).toEqual({ fn: "applyEq", arg: null });
  });
});
