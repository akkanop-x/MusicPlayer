/**
 * EQ store — equalizer.md §4/§5: presets + active preset (null = Flat)
 * draftBands = ค่า slider ที่กำลังลาก (apply ที่เสียงทันที แต่ persist เมื่อบันทึกเป็น
 * custom preset เท่านั้น — api.md #44 รับแค่ presetId|null)
 */
import { create } from "zustand";
import type { EqPresetDTO } from "@musicplayer/shared";
import { eqApi, settingsApi } from "../api";
import { getAudioEngine } from "../lib/audioEngine";

interface EqState {
  presets: EqPresetDTO[];
  activePresetId: string | null;
  /** bands ของ active preset (null = Flat) */
  activeBands: number[] | null;
  draftBands: number[] | null;
  setPresets: (presets: EqPresetDTO[]) => void;
  setActive: (presetId: string | null, bands: number[] | null) => void;
  setDraft: (bands: number[] | null) => void;
}

export const useEqStore = create<EqState>((set) => ({
  presets: [],
  activePresetId: null,
  activeBands: null,
  draftBands: null,
  setPresets: (presets) => set({ presets }),
  setActive: (activePresetId, activeBands) => set({ activePresetId, activeBands }),
  setDraft: (draftBands) => set({ draftBands }),
}));

/**
 * boot (equalizer.md §5) — ดึง presets + settings จาก server แล้ว apply ที่ engine
 * เพื่อให้ EQ ถูกต้องตั้งแต่เสียงแรก; เรียกจาก App effect เมื่อมี session
 */
export async function refreshEqFromServer(): Promise<void> {
  try {
    const [{ presets }, settings] = await Promise.all([
      eqApi.getPresets(),
      settingsApi.get(),
    ]);
    const active = presets.find((p) => p.id === settings.activeEqPresetId) ?? null;
    useEqStore.getState().setPresets(presets);
    useEqStore
      .getState()
      .setActive(settings.activeEqPresetId, active ? active.bands : null);
    getAudioEngine().applyEq(active ? active.bands : null);
  } catch {
    // ยังไม่ล็อกอิน / ดึงไม่สำเร็จ — ใช้ Flat ไปก่อน
  }
}

/** test-only — ล้าง store */
export function _resetEqStoreForTests(): void {
  useEqStore.setState({
    presets: [],
    activePresetId: null,
    activeBands: null,
    draftBands: null,
  });
}
