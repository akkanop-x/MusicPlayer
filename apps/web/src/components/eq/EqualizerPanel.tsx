/**
 * EqualizerPanel — equalizer.md §3/§4/§5
 * ลาก slider → apply ที่ audio graph ทันที (ไม่ throttle ฝั่งเสียง); persist เมื่อเลือก
 * preset (PUT /eq/active) หรือบันทึกเป็น custom preset (POST + active)
 */
import { useState } from "react";
import { EQ_BANDS, EQ_GAIN_MAX, EQ_GAIN_MIN } from "@musicplayer/shared";
import { eqApi } from "../../api";
import { getAudioEngine } from "../../lib/audioEngine";
import { useEqStore } from "../../stores/eqStore";
import { useToastStore } from "../../stores/playerStore";

function bandLabel(freq: number): string {
  return freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
}

export default function EqualizerPanel() {
  const engine = getAudioEngine();
  const show = useToastStore((s) => s.show);
  const { presets, activePresetId, activeBands, draftBands } = useEqStore();
  const [saving, setSaving] = useState(false);

  const shownBands = draftBands ?? activeBands ?? [];
  const isCustomDraft =
    draftBands !== null &&
    (activeBands === null ||
      activeBands.some((g, i) => g !== (draftBands[i] ?? 0)) ||
      activePresetId === null);

  function onBandChange(index: number, gain: number) {
    const next = EQ_BANDS.map((_, i) => (i === index ? gain : (shownBands[i] ?? 0)));
    useEqStore.getState().setDraft(next);
    engine.applyEq(next);
  }

  async function onSelectPreset(presetId: string) {
    // อ่านจาก store สด ๆ — ถูกเรียกหลังบันทึก preset ใหม่ (closure ของ render เก่ายังไม่มี)
    const preset = useEqStore.getState().presets.find((p) => p.id === presetId) ?? null;
    // apply local ทันที (ไม่รอ network) แล้วบันทึก — EQ_CHANGED ที่ตัวเองจะได้รับกลับมาเป็น confirm
    useEqStore.getState().setDraft(null);
    useEqStore.getState().setActive(preset?.id ?? null, preset ? preset.bands : null);
    engine.applyEq(preset ? preset.bands : null);
    try {
      const settings = await eqApi.setActive(preset ? preset.id : null);
      useEqStore
        .getState()
        .setActive(settings.activeEqPresetId, preset ? preset.bands : null);
    } catch (error) {
      show(String((error as Error).message));
    }
  }

  async function onSaveDraft() {
    if (!draftBands) return;
    const name = window.prompt("ชื่อ preset ของคุณ:");
    if (!name) return;
    setSaving(true);
    try {
      const preset = await eqApi.createPreset(name, draftBands);
      useEqStore.getState().setPresets([...useEqStore.getState().presets, preset]);
      await onSelectPreset(preset.id);
    } catch (error) {
      show(String((error as Error).message));
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteActive() {
    if (!activePresetId) return;
    try {
      await eqApi.deletePreset(activePresetId);
      useEqStore.getState().setDraft(null);
      useEqStore.getState().setActive(null, null);
      engine.applyEq(null);
    } catch (error) {
      show(String((error as Error).message));
    }
  }

  const activePreset = presets.find((p) => p.id === activePresetId) ?? null;

  return (
    <section data-testid="eq-panel" className="space-y-4">
      <div className="flex items-center gap-3">
        <label htmlFor="eq-preset" className="text-sm text-neutral-400">
          Preset
        </label>
        <select
          id="eq-preset"
          data-testid="eq-preset-select"
          value={activePresetId ?? ""}
          onChange={(e) => void onSelectPreset(e.target.value)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
        >
          <option value="">ไม่ใช้ EQ (Flat)</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
              {preset.isSystem ? "" : " (ของฉัน)"}
            </option>
          ))}
        </select>
        {activePreset && !activePreset.isSystem && (
          <button
            data-testid="eq-delete"
            onClick={() => void onDeleteActive()}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
          >
            ลบ preset นี้
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {EQ_BANDS.map((band, i) => (
          <li key={band.freq} className="flex items-center gap-3">
            <span className="w-12 text-right text-xs text-neutral-400">
              {bandLabel(band.freq)} Hz
            </span>
            <input
              aria-label={`band ${bandLabel(band.freq)} Hz`}
              data-testid={`eq-band-${i}`}
              type="range"
              min={EQ_GAIN_MIN}
              max={EQ_GAIN_MAX}
              step={0.5}
              value={shownBands[i] ?? 0}
              onChange={(e) => onBandChange(i, Number(e.target.value))}
              className="h-1 flex-1 accent-emerald-500"
            />
            <span
              data-testid={`eq-band-value-${i}`}
              className="w-12 text-xs tabular-nums text-neutral-400"
            >
              {(shownBands[i] ?? 0) > 0 ? "+" : ""}
              {shownBands[i] ?? 0} dB
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3">
        <button
          data-testid="eq-save"
          disabled={!isCustomDraft || saving}
          onClick={() => void onSaveDraft()}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-40"
        >
          บันทึกเป็น preset ของฉัน
        </button>
        <button
          data-testid="eq-reset"
          onClick={() => {
            useEqStore.getState().setDraft(null);
            engine.applyEq(null);
          }}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-900"
        >
          รีเซ็ตเป็น Flat
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        ลากแล้วได้ยินทันที — จะจำค่าไว้หลัง refresh ต้องบันทึกเป็น preset
      </p>
    </section>
  );
}
