/**
 * RealtimeHub — websocket.md §2/§7: ส่ง event ถึงทุก connection ของ user (room `user:{userId}`)
 * พร้อมแนบ `version` monotonic ต่อ user (เพิ่มทุก emit — client ทิ้ง event เก่ากว่าที่ตนถือ)
 * PlayerService เรียกผ่าน interface Broadcaster เพื่อไม่ผูกกับ socket.io โดยตรง (test ง่าย)
 */
import type { Server, Socket } from "socket.io";
import type { RealtimeEventName, RealtimeEnvelope } from "@musicplayer/shared";

export type Broadcaster = {
  emitToUser(
    userId: string,
    event: RealtimeEventName,
    payload: Record<string, unknown>,
  ): void;
};

export function roomOf(userId: string): string {
  return `user:${userId}`;
}

export class RealtimeHub implements Broadcaster {
  private io: Server | null = null;
  private versions = new Map<string, number>();

  /** เรียกครั้งเดียวตอน buildApp สร้าง io server — ก่อนหน้านั้น emit เป็น no-op */
  attach(io: Server): void {
    this.io = io;
  }

  emitToUser(
    userId: string,
    event: RealtimeEventName,
    payload: Record<string, unknown>,
  ): void {
    if (!this.io) return;
    const room = this.io.sockets.adapter.rooms.get(roomOf(userId));
    if (!room || room.size === 0) return; // ไม่มีใครฟัง — ไม่ต้องส่ง (SYNC_REQUEST คือกลไกกวาด)
    this.versions.set(userId, (this.versions.get(userId) ?? 0) + 1);
    const envelope: RealtimeEnvelope = {
      version: this.versions.get(userId)!,
    };
    this.io.to(roomOf(userId)).emit(event, { ...payload, ...envelope });
  }

  /** SYNC_REQUEST — ส่งกลับ socket เดียว (ไม่ใช่ทั้ง room) พร้อม version ถัดไปของ user */
  emitToSocket(
    socket: Socket,
    userId: string,
    event: RealtimeEventName,
    payload: Record<string, unknown>,
  ): void {
    if (!this.io) return;
    this.versions.set(userId, (this.versions.get(userId) ?? 0) + 1);
    socket.emit(event, {
      ...payload,
      version: this.versions.get(userId)!,
    });
  }
}
