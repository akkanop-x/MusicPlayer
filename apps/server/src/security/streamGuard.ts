/** In-memory guard ของ /stream — api.md §12: 60 req/min/user + ≤ 2 concurrent streams/user (MVP) */
export class StreamGuard {
  private readonly minuteWindows = new Map<
    string,
    { windowStart: number; count: number }
  >();
  private readonly concurrent = new Map<string, number>();

  constructor(
    private readonly maxPerMinute: number = 60,
    private readonly maxConcurrent: number = 2,
  ) {}

  tryAcquire(userId: string): "ok" | "rate-limited" | "too-many-streams" {
    const now = Date.now();
    const window = this.minuteWindows.get(userId);
    if (!window || now - window.windowStart >= 60_000) {
      this.minuteWindows.set(userId, { windowStart: now, count: 1 });
    } else {
      window.count += 1;
      if (window.count > this.maxPerMinute) return "rate-limited";
    }

    const current = this.concurrent.get(userId) ?? 0;
    if (current >= this.maxConcurrent) return "too-many-streams";
    this.concurrent.set(userId, current + 1);
    return "ok";
  }

  /** เรียกเมื่อ response จบ (client ปิด / เล่นจบ / error) */
  release(userId: string): void {
    const current = this.concurrent.get(userId) ?? 0;
    if (current <= 1) this.concurrent.delete(userId);
    else this.concurrent.set(userId, current - 1);
  }
}
