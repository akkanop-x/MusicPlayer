import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LavalinkClient } from "./LavalinkClient.js";
import { LavalinkRequestError, LavalinkUnavailableError } from "./errors.js";
import type { LavalinkInfo, LoadResult } from "./types.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let baseUrl = "";
let hits: Array<{ path: string | undefined; auth: string | undefined }>;
let handler: Handler;

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

beforeEach(async () => {
  hits = [];
  handler = (req, res) => jsonResponse(res, 200, { ok: true });
  server = createServer((req, res) => {
    hits.push({ path: req.url, auth: req.headers.authorization });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeClient(
  options?: Partial<ConstructorParameters<typeof LavalinkClient>[0]>,
): LavalinkClient {
  return new LavalinkClient({
    baseUrl,
    password: "secret-password",
    ...options,
  });
}

const searchResult: LoadResult = {
  loadType: "search",
  data: [
    {
      encoded: "QWJjRGVm",
      info: {
        identifier: "abc123",
        isSeekable: true,
        author: "Daft Punk",
        length: 253_000,
        isStream: false,
        position: 0,
        title: "One More Time",
        uri: "https://www.youtube.com/watch?v=abc123",
        artworkUrl: null,
        isrc: null,
        sourceName: "youtube",
      },
      pluginInfo: {},
    },
  ],
};

describe("LavalinkClient", () => {
  it("loadTracks: ตอบ parsed JSON + ส่ง Authorization เป็น raw password", async () => {
    handler = (req, res) => jsonResponse(res, 200, searchResult);

    const client = makeClient();
    const result = await client.loadTracks("ytsearch:one more time");

    expect(result).toEqual(searchResult);
    expect(hits[0]?.auth).toBe("secret-password");
    expect(hits[0]?.path).toBe(
      `/v4/loadtracks?identifier=${encodeURIComponent("ytsearch:one more time")}`,
    );
  });

  it("getInfo: คืน version/plugins", async () => {
    const info: LavalinkInfo = {
      version: { semver: "4.2.2", major: 4, minor: 2, patch: 2 },
      sourceManagers: ["youtube", "spotify"],
      plugins: [{ name: "youtube-plugin", version: "1.18.2" }],
    };
    handler = (req, res) => jsonResponse(res, 200, info);

    const result = await makeClient().getInfo();

    expect(result.version.semver).toBe("4.2.2");
    expect(result.plugins).toHaveLength(1);
  });

  it("401 → LavalinkRequestError และไม่ทริป circuit breaker", async () => {
    handler = (req, res) => jsonResponse(res, 401, { error: "invalid password" });

    const client = makeClient();
    await expect(client.loadTracks("ytsearch:x")).rejects.toBeInstanceOf(
      LavalinkRequestError,
    );
    // request ถัดไปยังออกนอก client ได้ (breaker ยังไม่เปิด)
    await expect(client.loadTracks("ytsearch:x")).rejects.toBeInstanceOf(
      LavalinkRequestError,
    );
    expect(hits).toHaveLength(2);
  });

  it("5xx ต่อเนื่องถึง threshold → breaker open แล้ว reject ทันทีโดยไม่ยิงออกนอก", async () => {
    handler = (req, res) => jsonResponse(res, 503, { error: "boom" });

    const client = makeClient({ breakerThreshold: 3, breakerCooldownMs: 60_000 });

    for (let i = 0; i < 3; i++) {
      await expect(client.loadTracks("ytsearch:x")).rejects.toBeInstanceOf(
        LavalinkRequestError,
      );
    }
    expect(hits).toHaveLength(3);

    await expect(client.loadTracks("ytsearch:x")).rejects.toBeInstanceOf(
      LavalinkUnavailableError,
    );
    expect(hits).toHaveLength(3); // request ไม่ออกนอก client
  });

  it("พ้น cooldown → half-open; สำเร็จแล้ว breaker close", async () => {
    let broken = true;
    handler = (req, res) => {
      if (broken) {
        jsonResponse(res, 503, { error: "boom" });
        return;
      }
      jsonResponse(res, 200, searchResult);
    };

    const client = makeClient({ breakerThreshold: 2, breakerCooldownMs: 50 });
    await expect(client.loadTracks("ytsearch:x")).rejects.toBeInstanceOf(
      LavalinkRequestError,
    );
    await expect(client.loadTracks("ytsearch:x")).rejects.toBeInstanceOf(
      LavalinkRequestError,
    );
    await expect(client.loadTracks("ytsearch:x")).rejects.toBeInstanceOf(
      LavalinkUnavailableError,
    );
    expect(hits).toHaveLength(2);

    await new Promise((resolve) => setTimeout(resolve, 70));
    broken = false;
    const result = await client.loadTracks("ytsearch:x"); // half-open ยอมให้ลอง
    expect(result).toEqual(searchResult);

    // close แล้ว — ยิงได้ปกติแม้ไม่พ้น cooldown
    await client.loadTracks("ytsearch:x");
    expect(hits).toHaveLength(4);
  });

  it("timeout → LavalinkUnavailableError", async () => {
    handler = (req, res) => {
      setTimeout(() => jsonResponse(res, 200, searchResult), 200);
    };

    const client = makeClient({ timeoutMs: 50 });
    await expect(client.loadTracks("ytsearch:x")).rejects.toBeInstanceOf(
      LavalinkUnavailableError,
    );
  });

  it("connection refused → LavalinkUnavailableError + นับเข้า breaker", async () => {
    const deadUrl = "http://127.0.0.1:1"; // port 1 = ไม่มีอะไร listen
    const client = new LavalinkClient({
      baseUrl: deadUrl,
      password: "x",
      breakerThreshold: 1,
    });

    await expect(client.loadTracks("ytsearch:x")).rejects.toBeInstanceOf(
      LavalinkUnavailableError,
    );
    await expect(client.loadTracks("ytsearch:x")).rejects.toBeInstanceOf(
      LavalinkUnavailableError,
    );
    const err: unknown = await client.loadTracks("ytsearch:x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LavalinkUnavailableError);
    expect((err as Error).message).toContain("circuit breaker");
  });
});
