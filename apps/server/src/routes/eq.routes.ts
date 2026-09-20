/**
 * /api/v1/settings + /api/v1/eq/* — api.md §10 (endpoint 38–44)
 * Broadcast EQ_CHANGED อยู่ที่นี่ (websocket.md §3): setActive / แก้ preset ที่ active /
 * ลบ preset ที่ active → hub.emitToUser พร้อม version envelope จาก RealtimeHub
 */
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { apiError, ERROR_STATUS, RealtimeEvents } from "@musicplayer/shared";
import { requireAuth } from "../plugins/requireAuth.js";
import { EqError, type EqService } from "../services/EqService.js";
import type { Broadcaster } from "../realtime/RealtimeHub.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EqRoutesDeps {
  jwtSecret: string;
  eq: EqService;
  hub: Broadcaster;
}

// locale เพิ่มตาม frontend.md §6.1 (สลับภาษาใน Settings → PATCH /settings { locale })
const patchSettingsBody = z.object({
  volume: z.number().int().min(0).max(100).optional(),
  muted: z.boolean().optional(),
  autoplay: z.boolean().optional(),
  locale: z.enum(["th", "en"]).optional(),
});

const createPresetBody = z.object({
  name: z.string(),
  bands: z.unknown(),
});

const updatePresetBody = z.object({
  name: z.string().optional(),
  bands: z.unknown().optional(),
});

const activeBody = z.object({
  presetId: z.string().regex(UUID_RE).nullable(),
});

function toHttp(error: unknown): { status: number; body: ReturnType<typeof apiError> } {
  if (error instanceof EqError) {
    return {
      status: ERROR_STATUS[error.code],
      body: apiError(error.code, error.message),
    };
  }
  throw error;
}

export const eqRoutes: FastifyPluginAsync<EqRoutesDeps> = async (app, deps) => {
  app.addHook("preHandler", requireAuth(deps.jwtSecret));

  // ---- Settings (api.md §10 #38/39) ----
  app.get("/settings", (request, reply) =>
    deps.eq
      .getSettings(request.user!.id)
      .then((settings) => reply.status(200).send(settings))
      .catch((error) => {
        const { status, body } = toHttp(error);
        return reply.status(status).send(body);
      }),
  );

  app.patch("/settings", (request, reply) => {
    const parsed = patchSettingsBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(
          apiError(
            "VALIDATION_ERROR",
            "volume (0–100) / muted / autoplay / locale (th|en) only",
          ),
        );
    }
    return deps.eq
      .patchSettings(request.user!.id, parsed.data)
      .then((settings) => reply.status(200).send(settings))
      .catch((error) => {
        const { status, body } = toHttp(error);
        return reply.status(status).send(body);
      });
  });

  // ---- Presets (#40–43) ----
  app.get("/eq/presets", (request, reply) =>
    deps.eq
      .listPresets(request.user!.id)
      .then((presets) => reply.status(200).send({ presets }))
      .catch((error) => {
        const { status, body } = toHttp(error);
        return reply.status(status).send(body);
      }),
  );

  app.post("/eq/presets", (request, reply) => {
    const parsed = createPresetBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "name and bands are required"));
    }
    return deps.eq
      .createPreset(request.user!.id, parsed.data)
      .then((preset) => reply.status(201).send(preset))
      .catch((error) => {
        const { status, body } = toHttp(error);
        return reply.status(status).send(body);
      });
  });

  app.patch("/eq/presets/:id", (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updatePresetBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "name / bands only"));
    }
    return deps.eq
      .updatePreset(request.user!.id, id, parsed.data)
      .then(({ preset, wasActive }) => {
        // equalizer.md §5: แก้ preset ที่กำลัง active → EQ_CHANGED ทุกอุปกรณ์
        if (wasActive) {
          deps.hub.emitToUser(request.user!.id, RealtimeEvents.EqChanged, {
            presetId: preset.id,
            bands: preset.bands,
          });
        }
        return reply.status(200).send(preset);
      })
      .catch((error) => {
        const { status, body } = toHttp(error);
        return reply.status(status).send(body);
      });
  });

  app.delete("/eq/presets/:id", (request, reply) => {
    const { id } = request.params as { id: string };
    return deps.eq
      .deletePreset(request.user!.id, id)
      .then(({ wasActive }) => {
        // FK ตั้ง active_eq_preset_id = NULL เอง → active กลายเป็น Flat
        if (wasActive) {
          deps.hub.emitToUser(request.user!.id, RealtimeEvents.EqChanged, {
            presetId: null,
            bands: null,
          });
        }
        return reply.status(204).send();
      })
      .catch((error) => {
        const { status, body } = toHttp(error);
        return reply.status(status).send(body);
      });
  });

  // ---- Active preset (#44) ----
  app.put("/eq/active", (request, reply) => {
    const parsed = activeBody.safeParse(request.body);
    if (!parsed.success) {
      return void reply
        .status(400)
        .send(apiError("VALIDATION_ERROR", "presetId (uuid | null) is required"));
    }
    return deps.eq
      .setActivePreset(request.user!.id, parsed.data.presetId)
      .then(({ settings, presetId, bands }) => {
        deps.hub.emitToUser(request.user!.id, RealtimeEvents.EqChanged, {
          presetId,
          bands,
        });
        return reply.status(200).send(settings);
      })
      .catch((error) => {
        const { status, body } = toHttp(error);
        return reply.status(status).send(body);
      });
  });
};
