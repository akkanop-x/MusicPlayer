import { PassThrough } from "node:stream";
import { ssrfFetch, SsrfError, type SafeUpstreamResponse } from "../security/ssrf.js";
import { ResolverClient, ResolverError } from "./resolver/ResolverClient.js";

export class StreamError extends Error {
  constructor(
    message: string,
    readonly code: "UPSTREAM_UNAVAILABLE" | "TRACK_UNPLAYABLE" | "NOT_FOUND",
  ) {
    super(message);
    this.name = "StreamError";
  }
}

export interface StreamTrackRow {
  id: string;
  sourceName: string;
  sourceIdentifier: string;
  isStream: boolean;
  streamUrl: string | null;
  contentType: string | null;
}

export interface StreamDeps {
  findTrackById(id: string): Promise<StreamTrackRow | undefined>;
  updateStreamMeta(
    id: string,
    meta: { streamUrl: string; contentType: string },
  ): Promise<void>;
  /** genre enrichment จาก metadata ของ YouTube เอง (ADR-009) — resolver คืนมาพร้อม stream */
  updateGenres(id: string, genres: string[]): Promise<void>;
  resolver: Pick<ResolverClient, "resolve">;
}

export interface OpenedStream {
  statusCode: number;
  headers: Record<string, string>;
  /** PassThrough — ข้างในมี prebuffer แล้ว pipe ต่อจาก upstream จริง */
  stream: PassThrough;
}

export interface StreamServiceOptions {
  /** cache stream URL ต่อ trackId — audio-pipeline.md §4 (~60 s) */
  urlCacheTtlMs?: number;
  /** จำนวน bytes ขั้นต่ำที่ prebuffer ก่อนตอบ (~2 s ของ audio ~128–256 kbps) */
  prebufferBytes?: number;
  /** เพดานเวลารอ prebuffer (audio-pipeline.md §4.1: 2–5 s) */
  prebufferMaxWaitMs?: number;
  /** upstream เงียบเกินนี้ → abort (security.md §8.5: stall > 30 s) */
  stallTimeoutMs?: number;
  /** SSRF options ผ่านตรง (allowlist/schemes — ใช้ใน test กับ mock server) */
  ssrf?: {
    allowlist?: string[];
    schemes?: string[];
    disableIpCheck?: boolean;
  };
}

const DEFAULTS = {
  urlCacheTtlMs: 60_000,
  prebufferBytes: 131_072, // 128 KB
  prebufferMaxWaitMs: 5_000,
  stallTimeoutMs: 30_000,
} as const;

/** audio-pipeline.md §3.2: ไม่ transcode — ส่งได้เฉพาะเสียงที่ browser เล่นได้เอง */
function isPlayableContentType(contentType: string | undefined): boolean {
  return (
    typeof contentType === "string" && contentType.toLowerCase().startsWith("audio/")
  );
}

/**
 * StreamService — backend.md §2 (ความปลอดภัยไว้สูงสุด):
 * trackId → resolver → SSRF check → prebuffer 2–5 s → pipe bytes พร้อม Range/206 passthrough
 * stream URL จริง**ไม่มีทาง**ออกไปถึง client
 */
export function createStreamService(
  deps: StreamDeps,
  options: StreamServiceOptions = {},
) {
  const config = { ...DEFAULTS, ...options };
  const urlCache = new Map<
    string,
    { expiresAt: number; resolved: { streamUrl: string; contentType: string } }
  >();

  async function resolvedStreamFor(
    track: StreamTrackRow,
  ): Promise<{ streamUrl: string; contentType: string }> {
    const cached = urlCache.get(track.id);
    if (cached && cached.expiresAt > Date.now()) return cached.resolved;
    if (cached) urlCache.delete(track.id);

    const result = await deps.resolver.resolve(
      track.sourceName,
      track.sourceIdentifier,
    );
    const resolved = { streamUrl: result.streamUrl, contentType: result.contentType };
    urlCache.set(track.id, { expiresAt: Date.now() + config.urlCacheTtlMs, resolved });
    // persist ไว้ debug/re-resolve — database.md §2.2 (ไม่ return ให้ client เด็ดขาด)
    await deps.updateStreamMeta(track.id, resolved).catch(() => undefined);
    // genre enrichment จาก YouTube metadata (ADR-009) — fire-and-forget ไม่ block stream
    if (result.genres.length > 0) {
      deps.updateGenres(track.id, result.genres).catch(() => undefined);
    }
    return resolved;
  }

  /** เก็บ bytes แรกก่อน (2–5 s) แล้วค่อยคืน stream — กันกระตุกช่วงต้น */
  function prebuffer(
    upstream: SafeUpstreamResponse["stream"],
    onAbort: (fn: () => void) => void,
  ): Promise<Buffer[]> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        upstream.removeListener("data", onData);
        upstream.removeListener("end", onEnd);
        resolve(chunks);
      };
      const onData = (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size >= config.prebufferBytes) {
          upstream.pause();
          finish();
        }
      };
      const onEnd = () => finish();
      const timer = setTimeout(finish, config.prebufferMaxWaitMs);
      upstream.on("data", onData);
      upstream.once("end", onEnd);
      onAbort(() => finish());
    });
  }

  async function openStream(
    trackId: string,
    rangeHeader?: string,
  ): Promise<OpenedStream> {
    const track = await deps.findTrackById(trackId);
    if (!track) throw new StreamError("Track not found", "NOT_FOUND");
    // local source = Phase 14 (ADR-008) — ยังไม่รองรับ
    if (track.sourceName === "local") {
      throw new StreamError("Local source is not supported yet", "TRACK_UNPLAYABLE");
    }

    let resolved: { streamUrl: string; contentType: string };
    try {
      resolved = await resolvedStreamFor(track);
    } catch (error) {
      if (error instanceof ResolverError) {
        throw new StreamError(
          error.code === "TRACK_UNPLAYABLE"
            ? "Track cannot be resolved"
            : "Stream resolver unavailable",
          error.code,
        );
      }
      throw error;
    }

    let upstream: SafeUpstreamResponse;
    try {
      upstream = await ssrfFetch(resolved.streamUrl, {
        headers: {
          ...(rangeHeader ? { Range: rangeHeader } : {}),
          "user-agent": "MusicPlayer/0.1 (private server proxy)",
        },
        timeoutMs: config.stallTimeoutMs,
        allowlist: config.ssrf?.allowlist,
        schemes: config.ssrf?.schemes,
        disableIpCheck: config.ssrf?.disableIpCheck,
      });
    } catch (error) {
      if (error instanceof SsrfError) {
        throw new StreamError(
          "Stream target rejected by security policy",
          "TRACK_UNPLAYABLE",
        );
      }
      if (error instanceof ResolverError) throw error;
      throw new StreamError("Upstream stream unavailable", "UPSTREAM_UNAVAILABLE");
    }

    const contentType = upstream.headers["content-type"];
    if (!isPlayableContentType(contentType)) {
      upstream.stream.destroy();
      throw new StreamError(
        `Upstream content-type not allowed: ${String(contentType ?? "unknown")}`,
        "TRACK_UNPLAYABLE",
      );
    }

    const output = new PassThrough();
    const headers: Record<string, string> = {
      "content-type": String(contentType),
      "accept-ranges": "bytes",
    };
    const statusCode = upstream.statusCode === 206 ? 206 : 200;
    const contentRange = upstream.headers["content-range"];
    if (statusCode === 206 && typeof contentRange === "string") {
      headers["content-range"] = contentRange;
    }
    const contentLength = upstream.headers["content-length"];
    if (typeof contentLength === "string") {
      headers["content-length"] = contentLength;
    }

    // stall guard: upstream เงียบเกิน stallTimeoutMs → ทำลายทั้งสองฝั่ง
    const stallTimer = setTimeout(() => {
      upstream.stream.destroy(
        new StreamError("Upstream stalled", "UPSTREAM_UNAVAILABLE"),
      );
      output.destroy();
    }, config.stallTimeoutMs);

    const buffered = await prebuffer(upstream.stream, (abort) => {
      upstream.stream.once("error", abort);
    });
    for (const chunk of buffered) {
      if (!output.destroyed) output.write(chunk);
    }
    upstream.stream.pipe(output);
    upstream.stream.on("close", () => clearTimeout(stallTimer));
    output.on("close", () => {
      clearTimeout(stallTimer);
      upstream.stream.destroy();
    });

    return { statusCode, headers, stream: output };
  }

  return { openStream };
}
