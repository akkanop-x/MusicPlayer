/**
 * socketClient — websocket.md §1/§5: Socket.IO client, path /ws
 * - connect เฉพาะเมื่อมี access token (handshake auth.token)
 * - auto-reconnect backoff 1 s→30 s; ทุกครั้งที่กลับมา → emit SYNC_REQUEST (resync ทั้งหมด)
 * - connect_error UNAUTHENTICATED → tryRefresh (REST) แล้ว reconnect ด้วย token ใหม่
 * - คำสั่ง client→server ใช้ ack + timeout 5 s → timeout = null (caller fallback REST)
 */
import { io, type Socket } from "socket.io-client";
import {
  RealtimeClientEvents,
  type PositionSyncAck,
  type TrackEndedAck,
  type TrackStalledAck,
} from "@musicplayer/shared";
import { tryRefresh } from "../api/client";
import { useAuthStore } from "../stores/authStore";

export type RealtimeEventHandler = (
  event: string,
  payload: Record<string, unknown>,
) => void;

const ACK_TIMEOUT_MS = 5_000;

let socket: Socket | null = null;
let handler: RealtimeEventHandler | null = null;

export function setRealtimeHandler(fn: RealtimeEventHandler): void {
  handler = fn;
}

export function isRealtimeConnected(): boolean {
  return socket?.connected ?? false;
}

/** hook สำหรับ E2E/diagnostics — สถานะ realtime ล่าสุดที่หน้าเว็บอ่านได้ */
export interface RealtimeDebugInfo {
  connected: boolean;
  lastEvent: string | null;
  lastEventAt: number;
  simulateNetworkDrop: () => void;
}

function updateDebug(patch: Partial<RealtimeDebugInfo>): void {
  const w = window as unknown as {
    __rt?: Partial<RealtimeDebugInfo>;
  };
  w.__rt = { ...w.__rt, ...patch };
}

export function connectRealtime(): void {
  if (socket) return; // มี connection อยู่แล้ว (reconnect เป็นหน้าที่ของ socket.io)
  const token = useAuthStore.getState().accessToken;
  if (!token) return;

  socket = io(window.location.origin, {
    path: "/ws",
    transports: ["polling", "websocket"],
    auth: { token },
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
  });

  socket.on("connect", () => {
    // websocket.md §5: reconnect สำเร็จ → SYNC_REQUEST เพื่อได้ state ล่าสุดทั้งก้อน
    socket?.emit(RealtimeClientEvents.SyncRequest, {});
    updateDebug({ connected: true });
  });

  socket.on("disconnect", () => updateDebug({ connected: false }));

  socket.on("connect_error", (error: Error) => {
    updateDebug({ connected: false });
    if (error.message === "UNAUTHENTICATED") void handleReauth();
  });

  socket.onAny((event: string, payload: unknown) => {
    updateDebug({ lastEvent: event, lastEventAt: Date.now() });
    if (handler && typeof event === "string") {
      handler(event, (payload ?? {}) as Record<string, unknown>);
    }
  });

  updateDebug({
    connected: false,
    simulateNetworkDrop: () => socket?.io.engine.close(),
  });
}

/** token หมดอายุกลาง session → refresh แล้ว reconnect ด้วย token ใหม่ (websocket.md §1) */
async function handleReauth(): Promise<void> {
  if (!(await tryRefresh())) {
    useAuthStore.getState().clear();
    window.location.assign("/login");
    return;
  }
  const token = useAuthStore.getState().accessToken;
  if (socket && token) {
    socket.auth = { token };
    socket.connect();
  }
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}

function emitWithAck<T>(event: string, payload: unknown): Promise<T | null> {
  if (!socket?.connected) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ACK_TIMEOUT_MS);
    socket!.emit(event, payload, (res: T) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

/** POSITION_SYNC — ส่งทุก 5 s ขณะเล่น + ตอน pause/seek/ended; ack ok:false → จูนตาม server */
export function positionSync(positionMs: number): Promise<PositionSyncAck | null> {
  return emitWithAck<PositionSyncAck>(RealtimeClientEvents.PositionSync, {
    positionMs,
  });
}

/** TRACK_ENDED (client report) — server advance ให้แล้ว broadcast กลับ */
export function reportTrackEnded(
  trackId: string,
  msPlayed: number,
): Promise<TrackEndedAck | null> {
  return emitWithAck<TrackEndedAck>(RealtimeClientEvents.TrackEndedReport, {
    trackId,
    msPlayed,
  });
}

/** TRACK_STALLED — server นับ (3 ครั้ง/30 s → exception + advance) */
export function reportStalled(
  trackId: string,
  positionMs: number,
  attempt: number,
): Promise<TrackStalledAck | null> {
  return emitWithAck<TrackStalledAck>(RealtimeClientEvents.TrackStalled, {
    trackId,
    positionMs,
    attempt,
  });
}
