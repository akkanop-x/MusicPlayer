/** consecutive-failure breaker — open แล้ว reject ทันทีจนพ้น cooldown (lavalink.md §3) */
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  tryAcquire(): void {
    if (this.openedAt === null) return;
    if (Date.now() - this.openedAt < this.cooldownMs) {
      throw new Error("circuit breaker is open");
    }
    // พ้น cooldown — half-open: ยอมให้ request นี้พยายาม, ผลลัพธ์ตัดสินที่ onSuccess/onFailure
  }

  onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) {
      this.openedAt = Date.now();
    }
  }
}
