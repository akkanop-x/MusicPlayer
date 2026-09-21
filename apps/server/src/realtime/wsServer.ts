/**
 * wsServer — websocket.md §1/§4: Socket.IO บน path /ws, handshake auth ด้วย JWT
 * ทุก connection join room `user:{userId}` → event ถึงทุก tab/device ของ user
 * คำสั่ง client→server ใช้ ack (client timeout 5 s → fallback REST)
 */
import { Server as SocketIoServer, type Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import {
  RealtimeClientEvents,
  RealtimeEvents,
  type PositionSyncAck,
  type TrackEndedAck,
  type TrackStalledAck,
} from "@musicplayer/shared";
import { verifyJwt } from "../services/auth/jwt.js";
import type { PlayerService } from "../services/PlayerService.js";
import { RealtimeHub, roomOf } from "./RealtimeHub.js";

export interface WsServerDeps {
  jwtSecret: string;
  player: PlayerService;
  hub: RealtimeHub;
}

/** อ่าน userId จาก handshake — token มาทาง auth.token หรือ Authorization header */
function authenticate(handshake: Socket["handshake"], jwtSecret: string): string {
  const header = handshake.headers.authorization;
  const token =
    (typeof handshake.auth?.token === "string" ? handshake.auth.token : null) ??
    (header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null);
  if (!token) throw new Error("UNAUTHENTICATED");
  return verifyJwt(token, jwtSecret).sub;
}

export function attachRealtime(
  app: FastifyInstance,
  deps: WsServerDeps,
): SocketIoServer {
  // app.server ของ Fastify มีตั้งแต่ก่อน listen — attach ได้ทันที
  const io = new SocketIoServer(app.server, {
    path: "/ws",
    cors: { origin: true, credentials: true },
  });
  deps.hub.attach(io);

  io.use((socket, next) => {
    try {
      socket.data.userId = authenticate(socket.handshake, deps.jwtSecret);
      next();
    } catch {
      next(new Error("UNAUTHENTICATED"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    void socket.join(roomOf(userId));
    app.log.debug({ userId, sid: socket.id }, "ws connected");

    // POSITION_SYNC — validate แล้วอัปเดต authoritative position; reject → บอกตำแหน่งจริงกลับ
    socket.on(
      RealtimeClientEvents.PositionSync,
      (payload: { positionMs?: unknown }, ack?: (res: PositionSyncAck) => void) => {
        const positionMs =
          typeof payload?.positionMs === "number" ? payload.positionMs : NaN;
        // syncPosition คืนตำแหน่ง authoritative พร้อมผล — emit ทันที ไม่มี async gap
        // (เดิม getState ย้อนหลังทำให้ correction ได้รับ state ที่ mutate ไปแล้ว)
        const result = deps.player.syncPosition(userId, positionMs);
        ack?.({ ok: result.ok });
        if (!result.ok) {
          deps.hub.emitToSocket(socket, userId, RealtimeEvents.PositionUpdated, {
            positionMs: result.positionMs,
          });
        }
      },
    );

    // TRACK_ENDED (client report) — trigger advance; คิวหมด → QUEUE_ENDED
    socket.on(
      RealtimeClientEvents.TrackEndedReport,
      async (payload: { trackId?: unknown }, ack?: (res: TrackEndedAck) => void) => {
        const trackId = typeof payload?.trackId === "string" ? payload.trackId : "";
        try {
          const result = await deps.player.reportTrackEnded(userId, trackId);
          ack?.({ ok: true, ended: result.ended });
        } catch {
          ack?.({ ok: false, ended: false });
        }
      },
    );

    // TRACK_STALLED — นับถี่; ครบ threshold → TRACK_EXCEPTION + advance
    socket.on(
      RealtimeClientEvents.TrackStalled,
      (
        payload: { trackId?: unknown; positionMs?: unknown; attempt?: unknown },
        ack?: (res: TrackStalledAck) => void,
      ) => {
        const trackId = typeof payload?.trackId === "string" ? payload.trackId : "";
        void deps.player.reportStalled(userId, trackId).then((result) => {
          ack?.({ ok: true, exception: result.exception });
        });
      },
    );

    // SYNC_REQUEST — resync ทั้งหมดหลัง reconnect/refresh (websocket.md §5)
    socket.on(RealtimeClientEvents.SyncRequest, async () => {
      const [state, queue] = await Promise.all([
        deps.player.getState(userId),
        deps.player.getQueue(userId),
      ]);
      deps.hub.emitToSocket(socket, userId, RealtimeEvents.PlayerStateChanged, {
        state: state.state,
        track: state.track,
        positionMs: state.positionMs,
      });
      deps.hub.emitToSocket(socket, userId, RealtimeEvents.QueueUpdated, {
        queue,
      });
    });

    socket.on("disconnect", () => {
      app.log.debug({ userId, sid: socket.id }, "ws disconnected");
    });
  });

  return io;
}
