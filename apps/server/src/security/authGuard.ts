/**
 * authGuard — security.md §3: login 5 req/min/IP + account lockout
 * (10 fail ต่อเนื่องใน 15 นาที → lock 15 นาที) — in-memory fixed window (MVP, 1–5 users)
 * error เป็น generic เสมอเพื่อไม่ leak ว่า email มีจริงหรือถูก lock
 */
export class AuthGuard {
  private readonly windows = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly maxPerMinute: number = 5,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(ip: string): "ok" | "rate-limited" {
    const now = this.now();
    const window = this.windows.get(ip);
    if (!window || now - window.windowStart >= 60_000) {
      this.windows.set(ip, { windowStart: now, count: 1 });
      return "ok";
    }
    window.count += 1;
    return window.count > this.maxPerMinute ? "rate-limited" : "ok";
  }
}

export class AccountLockout {
  private readonly state = new Map<string, { fails: number[]; lockedUntil: number }>();

  constructor(
    private readonly maxFails: number = 10,
    private readonly failWindowMs: number = 15 * 60_000,
    private readonly lockMs: number = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** true = กำลังถูก lock — caller ตอบ generic error เดียวกับรหัสผ่านผิด */
  isLocked(key: string): boolean {
    return (this.state.get(key)?.lockedUntil ?? 0) > this.now();
  }

  recordFailure(key: string): void {
    const now = this.now();
    const entry = this.state.get(key) ?? { fails: [], lockedUntil: 0 };
    entry.fails = entry.fails.filter((t) => now - t < this.failWindowMs);
    entry.fails.push(now);
    if (entry.fails.length >= this.maxFails) {
      entry.lockedUntil = now + this.lockMs;
      entry.fails = [];
    }
    this.state.set(key, entry);
  }

  /** เรียกเมื่อ login สำเร็จ — ล้างประวัติ fail */
  reset(key: string): void {
    this.state.delete(key);
  }
}
