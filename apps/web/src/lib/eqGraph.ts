/**
 * EQ graph builder — equalizer.md §1/§2 (BiquadFilter ×10, freq/Q fix ตาม EQ_BANDS)
 * ตัวเดียวกันทั้ง AudioEngine (AudioContext) และ browser smoke (OfflineAudioContext
 * วัด getFrequencyResponse ของจริง) — ห้าม rebuild หลัง boot (สร้างครั้งเดียว)
 */
import { EQ_BANDS } from "@musicplayer/shared";

/**
 * สร้าง filter ทั้ง 10 — ผู้เรียกต่อ chain เอง
 * ตั้งค่าเริ่มต้นด้วย .value ได้เฉพาะตอน create (ยังไม่มีเสียง) — หลังจากนี้เปลี่ยน gain
 * ผ่าน setTargetAtTime เท่านั้น (equalizer.md §3 กัน click/pop)
 */
export function createEqFilters(ctx: BaseAudioContext): BiquadFilterNode[] {
  return EQ_BANDS.map((band) => {
    const filter = ctx.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = band.freq;
    filter.Q.value = band.q;
    filter.gain.value = 0;
    return filter;
  });
}
