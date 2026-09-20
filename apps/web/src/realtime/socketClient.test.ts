import { beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeClientEvents, RealtimeEvents } from "@musicplayer/shared";
import { useAuthStore } from "../stores/authStore";
import {
  connectRealtime,
  disconnectRealtime,
  isRealtimeConnected,
  positionSync,
  setRealtimeHandler,
} from "./socketClient";

type EmitHandler = (...args: unknown[]) => void;
interface FakeSocket {
  connected: boolean;
  auth: unknown;
  on: (event: string, fn: EmitHandler) => void;
  onAny: (fn: (event: string, payload: unknown) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
  connect: () => void;
  disconnect: () => void;
  handlers: Map<string, EmitHandler>;
  emitted: Array<[string, unknown[]]>;
}

const { ioMock, socket } = vi.hoisted(() => {
  const makeSocket = () => {
    const handlers = new Map<string, EmitHandler>();
    const socket = {
      connected: false,
      auth: {},
      on: (event: string, fn: EmitHandler) => {
        handlers.set(event, fn);
      },
      onAny: (fn: (event: string, payload: unknown) => void) => {
        handlers.set("__any__", fn as unknown as EmitHandler);
      },
      emit: (event: string, ...args: unknown[]) => {
        socket.emitted.push([event, args]);
      },
      connect: () => {
        socket.connected = true;
      },
      disconnect: () => {
        socket.connected = false;
      },
      handlers,
      emitted: [] as Array<[string, unknown[]]>,
    };
    return socket as unknown as FakeSocket & Record<string, unknown>;
  };
  const shared = makeSocket();
  return { ioMock: vi.fn(() => shared), socket: shared };
});

vi.mock("socket.io-client", () => ({ io: ioMock }));

beforeEach(() => {
  ioMock.mockClear();
  // reset shared socket state
  socket.handlers.clear();
  socket.emitted.length = 0;
  socket.connected = false;
  disconnectRealtime();
  useAuthStore.setState({ accessToken: null });
});

describe("socketClient (websocket.md §1/§5)", () => {
  it("ไม่มี token → ไม่ connect", () => {
    connectRealtime();
    expect(ioMock).not.toHaveBeenCalled();
  });

  it("มี token → connect พร้อม auth.token + path /ws; connect → SYNC_REQUEST", () => {
    useAuthStore.setState({ accessToken: "tok-1" });
    connectRealtime();
    expect(ioMock).toHaveBeenCalledTimes(1);
    expect((ioMock.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]).toMatchObject({
      path: "/ws",
      auth: { token: "tok-1" },
    });
    // เสมือน server ยอมรับ connection
    (socket.handlers.get("connect") as EmitHandler)();
    const sync = socket.emitted.find(([e]) => e === RealtimeClientEvents.SyncRequest);
    expect(sync).toBeDefined();
  });

  it("onAny → ส่ง event เข้า handler ที่ลงทะเบียน", () => {
    useAuthStore.setState({ accessToken: "tok-1" });
    const seen: Array<[string, unknown]> = [];
    setRealtimeHandler((event, payload) => seen.push([event, payload]));
    connectRealtime();
    const any = socket.handlers.get("__any__") as (
      event: string,
      payload: unknown,
    ) => void;
    any(RealtimeEvents.QueueUpdated, { queue: {}, version: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe(RealtimeEvents.QueueUpdated);
  });

  it("positionSync เมื่อ connected → ได้ ack; ไม่ connected → null", async () => {
    // ยังไม่ connect
    expect(await positionSync(1_000)).toBeNull();

    useAuthStore.setState({ accessToken: "tok-1" });
    connectRealtime();
    socket.connected = true;
    const pending = positionSync(1_500);
    const [, args] = socket.emitted.find(
      ([e]) => e === RealtimeClientEvents.PositionSync,
    )!;
    const ack = args[1] as (res: { ok: boolean }) => void;
    ack({ ok: true });
    expect(await pending).toEqual({ ok: true });
  });

  it("ack ไม่มาภายใน timeout → resolve null (fallback REST)", async () => {
    vi.useFakeTimers();
    useAuthStore.setState({ accessToken: "tok-1" });
    connectRealtime();
    socket.connected = true;
    const pending = positionSync(1_500);
    const result = await vi.advanceTimersByTimeAsync(5_100).then(() => pending);
    expect(result).toBeNull();
    vi.useRealTimers();
  });

  it("disconnectRealtime → ปิด connection และ isRealtimeConnected false", () => {
    useAuthStore.setState({ accessToken: "tok-1" });
    connectRealtime();
    socket.connected = true;
    expect(isRealtimeConnected()).toBe(true);
    disconnectRealtime();
    expect(isRealtimeConnected()).toBe(false);
  });
});
