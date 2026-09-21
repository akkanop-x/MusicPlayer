/**
 * commandGuard — api.md §12: player/queue/radio commands 60 req/min/user
 * (MVP in-memory fixed window — pattern เดียวกับ SearchGuard/StreamGuard)
 */
export class CommandGuard {
  private readonly windows = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly maxPerMinute: number = 60,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(userId: string): "ok" | "rate-limited" {
    const now = this.now();
    const window = this.windows.get(userId);
    if (!window || now - window.windowStart >= 60_000) {
      this.windows.set(userId, { windowStart: now, count: 1 });
      return "ok";
    }
    window.count += 1;
    return window.count > this.maxPerMinute ? "rate-limited" : "ok";
  }
}
