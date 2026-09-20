import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostAllowed, isBlockedIp, ssrfFetch, SsrfError } from "./ssrf.js";

describe("hostAllowed (allowlist glob)", () => {
  const allowlist = ["*.googlevideo.com", "example.com"];
  it.each([
    ["rr1---sn-abc.googlevideo.com", true],
    ["googlevideo.com", false], // ต้องเป็น subdomain
    ["example.com", true],
    ["evil.com", false],
    ["googlevideo.com.evil.com", false],
  ])("%s → %s", (host, expected) => {
    expect(hostAllowed(host, allowlist)).toBe(expected);
  });
});

describe("isBlockedIp (security.md §8.3)", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["169.254.169.254", true], // cloud metadata
    ["0.0.0.0", true],
    ["::1", true],
    ["fe80::1", true],
    ["fc00::1", true],
    ["::ffff:10.0.0.1", true], // IPv4-mapped private
    ["8.8.8.8", false],
    ["142.250.4.90", false],
    ["2606:4700::1111", false],
  ])("%s blocked=%s", (ip, expected) => {
    expect(isBlockedIp(ip)).toBe(expected);
  });

  it("IP ที่ parse ไม่ได้ → blocked (ปลอดภัยไว้ก่อน)", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
  });
});

describe("ssrfFetch", () => {
  let server: Server;
  let baseUrl = "";
  let handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void;

  beforeEach(async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "audio/webm" });
      res.end("audio-bytes");
    };
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const testOptions = {
    schemes: ["http"],
    allowlist: ["127.0.0.1"],
    disableIpCheck: true, // mock server อยู่บน loopback (ปกติถูกบล็อก)
  };

  it("happy path: ได้ status/headers/stream ตาม upstream", async () => {
    const response = await ssrfFetch(`${baseUrl}/audio`, testOptions);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("audio/webm");
    const body = await readAll(response.stream);
    expect(body.toString()).toBe("audio-bytes");
  });

  it("host นอก allowlist → SsrfError ก่อนยิงออก network", async () => {
    await expect(
      ssrfFetch("http://evil.com/audio", testOptions),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("scheme ที่ไม่อนุญาต → SsrfError", async () => {
    await expect(
      ssrfFetch("ftp://127.0.0.1/audio", testOptions),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("follow redirect ภายใน allowlist (นับ ≤ 3 hops)", async () => {
    let hops = 0;
    handler = (req, res) => {
      if (hops < 2) {
        hops++;
        res.writeHead(302, { location: `${baseUrl}/hop${hops}` });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "audio/webm" });
      res.end("final");
    };
    const response = await ssrfFetch(`${baseUrl}/start`, {
      ...testOptions,
      redirectLimit: 3,
    });
    expect(response.statusCode).toBe(200);
    expect((await readAll(response.stream)).toString()).toBe("final");
  });

  it("redirect เกิน limit → SsrfError", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: `${baseUrl}/loop` });
      res.end();
    };
    await expect(
      ssrfFetch(`${baseUrl}/start`, { ...testOptions, redirectLimit: 3 }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("redirect ไป host นอก allowlist → SsrfError", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: "http://evil.com/steal" });
      res.end();
    };
    await expect(ssrfFetch(`${baseUrl}/start`, testOptions)).rejects.toBeInstanceOf(
      SsrfError,
    );
  });
});

describe("safeLookupFactory (กัน DNS rebinding)", () => {
  it("hostname ที่ resolve เป็น loopback → บล็อก", async () => {
    const { safeLookupFactory } = await import("./ssrf.js");
    const lookup = safeLookupFactory();
    await new Promise<void>((resolve) => {
      lookup("localhost", {}, (err) => {
        expect(err).toBeInstanceOf(SsrfError);
        expect((err as Error).message).toContain("blocked");
        resolve();
      });
    });
  });
});

function readAll(stream: import("node:stream").Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
