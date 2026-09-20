/**
 * repo ฝั่ง EQ — eq_presets + user_settings.active_eq_preset_id (database.md §2.7/§2.8)
 * bands เก็บ JSONB ครบ `[{freq, gain, q}]` (forward-compatible — equalizer.md §6)
 * แต่ชั้น service/DTO ใช้ gains: number[] (freq/Q fix ตาม EQ_BANDS)
 */
import { and, asc, eq, isNull, or } from "drizzle-orm";
import {
  EQ_BANDS,
  SYSTEM_EQ_PRESETS,
  type EqPresetDTO,
  type RepeatMode,
  type UserSettingsDTO,
} from "@musicplayer/shared";
import type { Db } from "../db/client.js";
import { eqPresets, userSettings } from "../db/schema.js";

type PresetRow = typeof eqPresets.$inferSelect;

function toDto(row: PresetRow): EqPresetDTO {
  const stored = row.bands as Array<{ freq: number; gain: number; q: number }>;
  return {
    id: row.id,
    name: row.name,
    bands: stored.map((band) => band.gain),
    isSystem: row.userId === null,
  };
}

function gainsToBands(gains: number[]) {
  return EQ_BANDS.map((band, i) => ({
    freq: band.freq,
    gain: gains[i] ?? 0,
    q: band.q,
  }));
}

export async function listEqPresets(db: Db, userId: string): Promise<EqPresetDTO[]> {
  // system (user_id NULL — ASC เจอ NULL ก่อนใน Postgres) แล้วตามด้วย custom ของ user นี้
  const rows = await db
    .select()
    .from(eqPresets)
    .where(or(isNull(eqPresets.userId), eq(eqPresets.userId, userId)))
    .orderBy(asc(eqPresets.userId), asc(eqPresets.name));
  return rows.map(toDto);
}

export async function findEqPresetRow(db: Db, id: string): Promise<PresetRow | null> {
  const [row] = await db.select().from(eqPresets).where(eq(eqPresets.id, id)).limit(1);
  return row ?? null;
}

export async function findEqPresetByName(
  db: Db,
  userId: string,
  name: string,
): Promise<PresetRow | null> {
  const [row] = await db
    .select()
    .from(eqPresets)
    .where(and(eq(eqPresets.userId, userId), eq(eqPresets.name, name)))
    .limit(1);
  return row ?? null;
}

export async function insertEqPreset(
  db: Db,
  userId: string,
  input: { name: string; gains: number[] },
): Promise<EqPresetDTO> {
  const [row] = await db
    .insert(eqPresets)
    .values({
      userId,
      name: input.name,
      bands: gainsToBands(input.gains),
      isSystem: false,
    })
    .returning();
  return toDto(row!);
}

export async function updateEqPresetRow(
  db: Db,
  row: PresetRow,
  patch: { name?: string; gains?: number[] },
): Promise<EqPresetDTO> {
  const [updated] = await db
    .update(eqPresets)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.gains ? { bands: gainsToBands(patch.gains) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(eqPresets.id, row.id))
    .returning();
  return toDto(updated!);
}

export async function deleteEqPresetRow(db: Db, id: string): Promise<void> {
  // FK user_settings.active_eq_preset_id ON DELETE SET NULL — active กลายเป็น Flat เอง
  await db.delete(eqPresets).where(eq(eqPresets.id, id));
}

export async function getActiveEqPresetId(
  db: Db,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ activeEqPresetId: userSettings.activeEqPresetId })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return row?.activeEqPresetId ?? null;
}

export async function saveActiveEqPreset(
  db: Db,
  userId: string,
  presetId: string | null,
): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, activeEqPresetId: presetId })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { activeEqPresetId: presetId, updatedAt: new Date() },
    });
}

/** GET/PATCH /settings — คืน DTO ครบตาม api.md §4 #38 (แถวไม่มี → default ตาม schema) */
export async function getUserSettingsFull(
  db: Db,
  userId: string,
): Promise<UserSettingsDTO> {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (!row) {
    return {
      volume: 80,
      muted: false,
      autoplay: true,
      repeatMode: "off",
      shuffle: false,
      activeEqPresetId: null,
      locale: "th",
    };
  }
  return {
    volume: row.volume,
    muted: row.muted,
    autoplay: row.autoplay,
    repeatMode: row.repeatMode as RepeatMode,
    shuffle: row.shuffle,
    activeEqPresetId: row.activeEqPresetId,
    locale: row.locale,
  };
}

export async function patchUserSettings(
  db: Db,
  userId: string,
  patch: { volume?: number; muted?: boolean; autoplay?: boolean },
): Promise<UserSettingsDTO> {
  await db
    .insert(userSettings)
    .values({ userId, ...patch })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...patch, updatedAt: new Date() },
    });
  return getUserSettingsFull(db, userId);
}

/** seed system presets ตอน boot — idempotent ด้วย id คงที่ (equalizer.md §4) */
export async function seedSystemEqPresets(db: Db): Promise<void> {
  await db
    .insert(eqPresets)
    .values(
      SYSTEM_EQ_PRESETS.map((preset) => ({
        id: preset.id,
        userId: null,
        name: preset.name,
        bands: gainsToBands(preset.gains),
        isSystem: true,
      })),
    )
    .onConflictDoNothing({ target: eqPresets.id });
}
