/** In-memory guard ของ /search — api.md §13: 30 req/min/user (pattern เดียวกับ streamGuard) */
export class SearchGuard {
  private readonly minuteWindows = new Map<
    string,
    { windowStart: number; count: number }
  >();

  constructor(private readonly maxPerMinute: number = 30) {}

  tryAcquire(userId: string): "ok" | "rate-limited" {
    const now = Date.now();
    const window = this.minuteWindows.get(userId);
    if (!window || now - window.windowStart >= 60_000) {
      this.minuteWindows.set(userId, { windowStart: now, count: 1 });
      return "ok";
    }
    window.count += 1;
    return window.count > this.maxPerMinute ? "rate-limited" : "ok";
  }
}
