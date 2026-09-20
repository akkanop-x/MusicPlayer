/**
 * EqService — persistence ล้วน (eq_presets + user_settings); broadcast EQ_CHANGED อยู่ที่
 * routes (มี userId + hub ครบ — เหตุผลใน spec.md §ออกแบบไว้แล้ว) → inject ใน test ได้ทั้งชุด
 */
import {
  validateEqBands,
  type EqPresetDTO,
  type UserSettingsDTO,
} from "@musicplayer/shared";
import type { Db } from "../db/client.js";
import {
  deleteEqPresetRow,
  findEqPresetByName,
  findEqPresetRow,
  getActiveEqPresetId,
  getUserSettingsFull,
  insertEqPreset,
  listEqPresets,
  patchUserSettings,
  saveActiveEqPreset,
  updateEqPresetRow,
} from "../repositories/eq.repo.js";

export class EqError extends Error {
  constructor(
    public readonly code:
      "VALIDATION_ERROR" | "EQ_PRESET_NAME_TAKEN" | "NOT_FOUND" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
  }
}

export interface EqService {
  listPresets(userId: string): Promise<EqPresetDTO[]>;
  createPreset(
    userId: string,
    input: { name: string; bands: unknown },
  ): Promise<EqPresetDTO>;
  updatePreset(
    userId: string,
    id: string,
    input: { name?: string; bands?: unknown },
  ): Promise<{ preset: EqPresetDTO; wasActive: boolean }>;
  deletePreset(userId: string, id: string): Promise<{ wasActive: boolean }>;
  getActivePresetId(userId: string): Promise<string | null>;
  setActivePreset(
    userId: string,
    presetId: string | null,
  ): Promise<{
    settings: UserSettingsDTO;
    presetId: string | null;
    bands: number[] | null;
  }>;
  getSettings(userId: string): Promise<UserSettingsDTO>;
  patchSettings(
    userId: string,
    patch: { volume?: number; muted?: boolean; autoplay?: boolean },
  ): Promise<UserSettingsDTO>;
}

export function createEqService(db: Db): EqService {
  return {
    async listPresets(userId) {
      return listEqPresets(db, userId);
    },

    async createPreset(userId, input) {
      const bands = validateEqBands(input.bands);
      if (!bands) {
        throw new EqError(
          "VALIDATION_ERROR",
          "bands must be an array of 10 gains in [-12, +12]",
        );
      }
      const name = input.name.trim();
      if (name.length === 0 || name.length > 100) {
        throw new EqError("VALIDATION_ERROR", "name must be 1–100 characters");
      }
      if (await findEqPresetByName(db, userId, name)) {
        throw new EqError("EQ_PRESET_NAME_TAKEN", `preset "${name}" already exists`);
      }
      return insertEqPreset(db, userId, { name, gains: bands });
    },

    async updatePreset(userId, id, input) {
      const row = await findEqPresetRow(db, id);
      if (!row) throw new EqError("NOT_FOUND", "preset not found");
      if (row.userId !== userId) {
        // system preset (หรือของคนอื่น — มองเห็นเป็น NOT_FOUND เดียวกันจึงตอบ FORBIDDEN เฉพาะ system;
        // ของคนอื่นหาไม่เจอจาก list อยู่แล้ว ตอบ 404 ตาม api.md #42)
        throw row.userId === null
          ? new EqError("FORBIDDEN", "system preset cannot be modified")
          : new EqError("NOT_FOUND", "preset not found");
      }
      let gains: number[] | undefined;
      if (input.bands !== undefined) {
        const validated = validateEqBands(input.bands);
        if (!validated) {
          throw new EqError(
            "VALIDATION_ERROR",
            "bands must be an array of 10 gains in [-12, +12]",
          );
        }
        gains = validated;
      }
      let name: string | undefined;
      if (input.name !== undefined) {
        name = input.name.trim();
        if (name.length === 0 || name.length > 100) {
          throw new EqError("VALIDATION_ERROR", "name must be 1–100 characters");
        }
        if (name !== row.name && (await findEqPresetByName(db, userId, name))) {
          throw new EqError("EQ_PRESET_NAME_TAKEN", `preset "${name}" already exists`);
        }
      }
      const preset = await updateEqPresetRow(db, row, { name, gains });
      const wasActive = (await getActiveEqPresetId(db, userId)) === id;
      return { preset, wasActive };
    },

    async deletePreset(userId, id) {
      const row = await findEqPresetRow(db, id);
      if (!row) throw new EqError("NOT_FOUND", "preset not found");
      if (row.userId !== userId) {
        throw row.userId === null
          ? new EqError("FORBIDDEN", "system preset cannot be deleted")
          : new EqError("NOT_FOUND", "preset not found");
      }
      await deleteEqPresetRow(db, id);
      return { wasActive: (await getActiveEqPresetId(db, userId)) === id };
    },

    async getActivePresetId(userId) {
      return getActiveEqPresetId(db, userId);
    },

    async setActivePreset(userId, presetId) {
      let bands: number[] | null = null;
      if (presetId !== null) {
        const row = await findEqPresetRow(db, presetId);
        // system หรือของตัวเองเท่านั้น — ของคนอื่นถือว่าไม่มี (api.md #44: 404)
        if (!row || (row.userId !== null && row.userId !== userId)) {
          throw new EqError("NOT_FOUND", "preset not found");
        }
        bands = (row.bands as Array<{ gain: number }>).map((band) => band.gain);
      }
      await saveActiveEqPreset(db, userId, presetId);
      const settings = await getUserSettingsFull(db, userId);
      return { settings, presetId, bands };
    },

    async getSettings(userId) {
      return getUserSettingsFull(db, userId);
    },

    async patchSettings(userId, patch) {
      return patchUserSettings(db, userId, patch);
    },
  };
}
