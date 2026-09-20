import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createStreamService, StreamError, type StreamDeps } from "./StreamService.js";
import type { ResolvedStream } from "./resolver/ResolverClient.js";

function makeDeps(
  overrides?: Partial<StreamDeps> & { resolveResult?: Partial<ResolvedStream> | Error },
) {
  const track = {
    id: "11111111-1111-1111-1111-111111111111",
    sourceName: "youtube",
    sourceIdentifier: "dQw4w9WgXcQ",
    isStream: false,
    streamUrl: null,
    contentType: null,
  };
  const resolve = vi.fn(async () => {
    const r = overrides?.resolveResult;
    if (r instanceof Error) throw r;
    return {
      streamUrl: "http://127.0.0.1:0/not-used",
      contentType: "audio/webm",
      durationMs: 213_000,
      ...r,
    } as ResolvedStream;
  });
  const deps: StreamDeps = {
    findTrackById: vi.fn(async (id: string) => (id === track.id ? track : undefined)),
    updateStreamMeta: vi.fn(async () => undefined),
    resolver: { resolve },
    ...overrides,
  };
  return { deps, resolve, track };
}

/** mock upstream server จ่าย bytes ชุดเดียว (127.0.0.1 — allowlist ผ่าน options) */
let server: Server;

async function startUpstream(
  handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void,
): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${port}/audio`;
}

async function stopUpstream(): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

const ssrfOptions = {
  allowlist: ["127.0.0.1"],
  schemes: ["http"],
  disableIpCheck: true,
};

function readAll(stream: import("node:stream").Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

describe("StreamService", () => {
  it("happy path: prebuffer → 200 + content-type + ได้ bytes ครบ", async () => {
    const payload = Buffer.alloc(200_000, 7); // > prebufferBytes default (128 KB)
    const url = await startUpstream((req, res) => {
      res.writeHead(200, { "content-type": "audio/webm" });
      res.end(payload);
    });
    const { deps } = makeDeps({ resolveResult: { streamUrl: url } });
    const service = createStreamService(deps, { ssrf: ssrfOptions });

    const opened = await service.openStream("11111111-1111-1111-1111-111111111111");
    expect(opened.statusCode).toBe(200);
    expect(opened.headers["content-type"]).toBe("audio/webm");
    expect(opened.headers["accept-ranges"]).toBe("bytes");
    expect((await readAll(opened.stream)).length).toBe(payload.length);
    await stopUpstream();
  });

  it("Range: bytes=N- → 206 + Content-Range passthrough", async () => {
    const url = await startUpstream((req, res) => {
      expect(req.headers.range).toBe("bytes=1000-");
      res.writeHead(206, {
        "content-type": "audio/webm",
        "content-range": "bytes 1000-199999/200000",
        "content-length": "4",
      });
      res.end("rest");
    });
    const { deps } = makeDeps({ resolveResult: { streamUrl: url } });
    const service = createStreamService(deps, { ssrf: ssrfOptions, prebufferBytes: 1 });

    const opened = await service.openStream(
      "11111111-1111-1111-1111-111111111111",
      "bytes=1000-",
    );
    expect(opened.statusCode).toBe(206);
    expect(opened.headers["content-range"]).toBe("bytes 1000-199999/200000");
    expect(opened.headers["content-length"]).toBe("4");
    await readAll(opened.stream);
    await stopUpstream();
  });

  it("cache stream URL ต่อ trackId (TTL) — resolve ครั้งเดียว", async () => {
    let calls = 0;
    const url = await startUpstream((req, res) => {
      res.writeHead(200, { "content-type": "audio/webm" });
      res.end("x");
    });
    const { deps } = makeDeps();
    deps.resolver.resolve = vi.fn(async () => {
      calls++;
      return { streamUrl: url, contentType: "audio/webm", durationMs: 1 };
    });
    const service = createStreamService(deps, { ssrf: ssrfOptions, prebufferBytes: 1 });
    const id = "11111111-1111-1111-1111-111111111111";

    const a = await service.openStream(id);
    await readAll(a.stream);
    const b = await service.openStream(id);
    await readAll(b.stream);
    expect(calls).toBe(1);
    await stopUpstream();
  });

  it("content-type ไม่ใช่ audio/* → TRACK_UNPLAYABLE (security.md §8.5)", async () => {
    const url = await startUpstream((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>not audio</html>");
    });
    const { deps } = makeDeps({ resolveResult: { streamUrl: url } });
    const service = createStreamService(deps, { ssrf: ssrfOptions });
    await expect(
      service.openStream("11111111-1111-1111-1111-111111111111"),
    ).rejects.toMatchObject({
      code: "TRACK_UNPLAYABLE",
    });
    await stopUpstream();
  });

  it("URL นอก allowlist → TRACK_UNPLAYABLE (SSRF guard)", async () => {
    const { deps } = makeDeps({
      resolveResult: { streamUrl: "http://evil.com/steal" },
    });
    const service = createStreamService(deps, { ssrf: ssrfOptions });
    await expect(
      service.openStream("11111111-1111-1111-1111-111111111111"),
    ).rejects.toMatchObject({
      code: "TRACK_UNPLAYABLE",
    });
  });

  it("track ไม่พบ → NOT_FOUND; source local → TRACK_UNPLAYABLE", async () => {
    const { deps } = makeDeps();
    const service = createStreamService(deps, { ssrf: ssrfOptions });
    await expect(
      service.openStream("22222222-2222-2222-2222-222222222222"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const localDeps: StreamDeps = {
      ...deps,
      findTrackById: async (id) => ({
        id,
        sourceName: "local",
        sourceIdentifier: "/tmp/x.mp3",
        isStream: false,
        streamUrl: null,
        contentType: null,
      }),
    };
    const localService = createStreamService(localDeps, { ssrf: ssrfOptions });
    await expect(
      localService.openStream("11111111-1111-1111-1111-111111111111"),
    ).rejects.toMatchObject({
      code: "TRACK_UNPLAYABLE",
    });
  });

  it("resolver ล่ม → UPSTREAM_UNAVAILABLE", async () => {
    const { deps } = makeDeps({
      resolveResult: new StreamError("Resolver unreachable", "UPSTREAM_UNAVAILABLE"),
    });
    const service = createStreamService(deps, { ssrf: ssrfOptions });
    await expect(
      service.openStream("11111111-1111-1111-1111-111111111111"),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("updateStreamMeta ถูกเรียกหลัง resolve (persist ไว้ debug)", async () => {
    const url = await startUpstream((req, res) => {
      res.writeHead(200, { "content-type": "audio/webm" });
      res.end("x");
    });
    const { deps, resolve } = makeDeps({ resolveResult: { streamUrl: url } });
    const service = createStreamService(deps, { ssrf: ssrfOptions, prebufferBytes: 1 });
    const opened = await service.openStream("11111111-1111-1111-1111-111111111111");
    await readAll(opened.stream);
    await new Promise((r) => setTimeout(r, 10));
    expect(resolve).toHaveBeenCalled();
    expect(deps.updateStreamMeta).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      expect.objectContaining({ streamUrl: url, contentType: "audio/webm" }),
    );
    await stopUpstream();
  });
});
