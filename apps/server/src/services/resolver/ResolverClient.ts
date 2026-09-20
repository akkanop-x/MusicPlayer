import { CircuitBreaker } from "../circuitBreaker.js";

export interface ResolverClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface ResolvedStream {
  streamUrl: string;
  contentType: string;
  durationMs: number;
}

export class ResolverError extends Error {
  constructor(
    message: string,
    readonly code: "UPSTREAM_UNAVAILABLE" | "TRACK_UNPLAYABLE",
  ) {
    super(message);
    this.name = "ResolverError";
  }
}

/** client ไป resolver container — audio-pipeline.md §3.1 (คนเดียวที่ถาม resolver ได้คือ StreamService) */
export class ResolverClient {
  private readonly breaker: CircuitBreaker;
  private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

  constructor(private readonly options: ResolverClientOptions) {
    this.breaker = new CircuitBreaker(
      options.breakerThreshold ?? 3,
      options.breakerCooldownMs ?? 30_000,
    );
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async resolve(source: string, identifier: string): Promise<ResolvedStream> {
    try {
      this.breaker.tryAcquire();
    } catch {
      throw new ResolverError(
        "Resolver circuit breaker is open",
        "UPSTREAM_UNAVAILABLE",
      );
    }

    const url = `${this.options.baseUrl.replace(/\/+$/, "")}/resolve?source=${encodeURIComponent(source)}&identifier=${encodeURIComponent(identifier)}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
    } catch (error) {
      this.breaker.onFailure();
      throw new ResolverError(
        `Resolver unreachable: ${String(error)}`,
        "UPSTREAM_UNAVAILABLE",
      );
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      const code =
        body?.error?.code === "TRACK_UNPLAYABLE"
          ? "TRACK_UNPLAYABLE"
          : "UPSTREAM_UNAVAILABLE";
      // TRACK_UNPLAYABLE เป็น "คำตอบ" ไม่ใช่ความล้มเหลวของ resolver — ไม่นับเข้า breaker
      if (code === "UPSTREAM_UNAVAILABLE") this.breaker.onFailure();
      throw new ResolverError(
        body?.error?.message ?? `Resolver responded ${response.status}`,
        code,
      );
    }

    const payload = (await response
      .json()
      .catch(() => null)) as Partial<ResolvedStream> | null;
    if (!payload?.streamUrl) {
      this.breaker.onFailure();
      throw new ResolverError(
        "Resolver returned malformed response",
        "UPSTREAM_UNAVAILABLE",
      );
    }
    this.breaker.onSuccess();
    return {
      streamUrl: payload.streamUrl,
      contentType: payload.contentType ?? "application/octet-stream",
      durationMs: payload.durationMs ?? 0,
    };
  }
}
