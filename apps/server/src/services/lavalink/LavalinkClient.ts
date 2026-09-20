import { LavalinkRequestError, LavalinkUnavailableError } from "./errors.js";
import type {
  LavalinkFetch,
  LavalinkInfo,
  LavalinkTrack,
  LoadResult,
} from "./types.js";

export interface LavalinkClientOptions {
  baseUrl: string;
  /** Lavalink ใช้ Authorization แบบ raw password (ไม่ใช่ Bearer) */
  password: string;
  timeoutMs?: number;
  /** จำนวน failure ต่อเนื่องก่อนเปิด breaker */
  breakerThreshold?: number;
  /** เวลาที่ breaker อยู่ในสถานะ open ก่อนยอมให้ลองอีกครั้ง (half-open) */
  breakerCooldownMs?: number;
  fetchImpl?: LavalinkFetch;
}

/**
 * คนเดียวที่รู้จัก Lavalink (backend.md §1) — REST เท่านั้น
 * เราไม่ใช้ระบบ WS/session/player ของ Lavalink เลย (lavalink.md §3)
 */
export class LavalinkClient {
  private readonly baseUrl: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: LavalinkFetch;

  private readonly breaker: CircuitBreaker;

  constructor(options: LavalinkClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.password = options.password;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.breaker = new CircuitBreaker(
      options.breakerThreshold ?? 3,
      options.breakerCooldownMs ?? 30_000,
    );
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** GET /v4/loadtracks?identifier=… */
  async loadTracks(identifier: string): Promise<LoadResult> {
    const url = `${this.baseUrl}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`;
    return (await this.getJson(url)) as LoadResult;
  }

  /** GET /v4/decodetrack?encodedTrack=… */
  async decodeTrack(encodedTrack: string): Promise<LavalinkTrack> {
    const url = `${this.baseUrl}/v4/decodetrack?encodedTrack=${encodeURIComponent(encodedTrack)}`;
    return (await this.getJson(url)) as LavalinkTrack;
  }

  /** GET /v4/info — health check + ดู version/plugins ที่โหลด */
  async getInfo(): Promise<LavalinkInfo> {
    return (await this.getJson(`${this.baseUrl}/v4/info`)) as LavalinkInfo;
  }

  private async getJson(url: string): Promise<unknown> {
    this.breaker.tryAcquire();
    try {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: this.password },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        // 4xx เป็น config/usage error (เช่น password ผิด) — ไม่ทริป breaker แต่ fail ทันที
        const body = await response.text().catch(() => "");
        const error = new LavalinkRequestError(
          `Lavalink responded ${response.status} for ${new URL(url).pathname}`,
          response.status,
          body,
        );
        if (response.status >= 500) {
          this.breaker.onFailure();
        }
        throw error;
      }
      const json: unknown = await response.json();
      this.breaker.onSuccess();
      return json;
    } catch (error) {
      if (error instanceof LavalinkRequestError) throw error;
      // network refused / DNS / timeout → upstream ไม่พร้อมใช้
      this.breaker.onFailure();
      throw new LavalinkUnavailableError(`Lavalink unreachable at ${this.baseUrl}`, {
        cause: error,
      });
    }
  }
}

/** consecutive-failure breaker — open แล้ว reject ทันทีจนพ้น cooldown */
class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  tryAcquire(): void {
    if (this.openedAt === null) return;
    if (Date.now() - this.openedAt < this.cooldownMs) {
      throw new LavalinkUnavailableError("Lavalink circuit breaker is open");
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
