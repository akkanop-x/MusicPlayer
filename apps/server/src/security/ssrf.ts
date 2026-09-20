import { BlockList, isIP } from "node:net";
import dns from "node:dns";
import https from "node:https";
import http from "node:http";

/**
 * SSRF guards — security.md §8 (บังคับของ Phase 3, "ส่วนที่เสี่ยงที่สุดของระบบ")
 * 1. URL ต้องอยู่ใน host allowlist
 * 2. DNS resolve แล้วตรวจทุก IP ก่อน connect (บล็อก private/loopback/link-local/ULA/metadata)
 * 3. connect ผูกกับ IP ที่ตรวจแล้ว (กัน DNS rebinding) + ตรวจซ้ำทุก redirect hop (≤ 3)
 */

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const DEFAULT_ALLOWLIST = ["*.googlevideo.com"];

/** สถานะ HTTP ของ response ที่ผ่าน guard แล้ว — route ใช้ pipe ต่อ */
export interface SafeUpstreamResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
}

function parseAllowlist(envValue: string | undefined): string[] {
  const raw = envValue?.trim();
  if (!raw) return DEFAULT_ALLOWLIST;
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

/** glob แบบง่าย: `*.googlevideo.com` ครอบทุก subdomain ชั้นเดียวถึงหลายชั้น */
export function hostAllowed(host: string, allowlist: string[]): boolean {
  const normalized = host.toLowerCase();
  return allowlist.some((pattern) => {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // ".googlevideo.com"
      return normalized.endsWith(suffix) && normalized.length > suffix.length;
    }
    return normalized === pattern;
  });
}

// node BlockList มีพฤติกรรมกำกวมเมื่อ IPv4/IPv6 อยู่ list เดียวกัน (IPv4 ถูก normalize
// เป็น mapped-IPv6 แล้วชนกับ ::ffff:0:0/96) → แยก list ตาม version และ normalize เอง
const V4 = new BlockList();
V4.addSubnet("0.0.0.0", 8, "ipv4"); // "this network"
V4.addSubnet("10.0.0.0", 8, "ipv4"); // private
V4.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
V4.addSubnet("169.254.0.0", 16, "ipv4"); // link-local (+ cloud metadata 169.254.169.254)
V4.addSubnet("172.16.0.0", 12, "ipv4"); // private
V4.addSubnet("192.168.0.0", 16, "ipv4"); // private

/** BlockList ของ node เพี้ยนกับ IPv6 (Node 26: check คืน false, addAddress throw) → ตรวจเองด้วย BigInt */
function ipv6ToBigInt(ip: string): bigint {
  const doubleColon = ip.indexOf("::");
  const head = doubleColon >= 0 ? ip.slice(0, doubleColon) : ip;
  const tail = doubleColon >= 0 ? ip.slice(doubleColon + 2) : null;
  const headGroups = head ? head.split(":").filter(Boolean) : [];
  const tailGroups = tail !== null ? tail.split(":").filter(Boolean) : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [
    ...headGroups,
    ...Array(Math.max(0, missing)).fill("0"),
    ...tailGroups,
  ].slice(0, 8);
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n);
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return V4.check(ip);
  if (version === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) → ตรวจส่วน IPv4
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped?.[1]) return V4.check(mapped[1]);
    if (ip === "::" || ip === "::1") return true; // unspecified / loopback
    const value = ipv6ToBigInt(ip);
    const top10 = value >> 118n;
    if (top10 === 0b1111111010n) return true; // fe80::/10 link-local
    const top7 = value >> 121n;
    if (top7 === 0b1111110n) return true; // fc00::/7 unique local
    return false;
  }
  return true; // ไม่ใช่ IP ที่รู้จัก → ถือว่าไม่ปลอดภัย
}

interface LookupEntry {
  address: string;
  family: number;
}

type SafeLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupEntry | LookupEntry[],
  family?: number,
) => void;

export type SafeLookup = (
  hostname: string,
  options: unknown,
  callback: SafeLookupCallback,
) => void;

/**
 * custom dns.lookup สำหรับ node http/https — resolve แล้ว**ตรวจ IP ทุกตัว**
 * ก่อนคืนให้ net.connect ใช้ (กัน DNS rebinding เพราะ connect จะใช้ IP ที่ผ่านการตรวจเท่านั้น)
 */
export function safeLookupFactory(
  factoryOptions: { disableIpCheck?: boolean } = {},
): SafeLookup {
  return (hostname, lookupOptions, callback) => {
    dns.lookup(
      hostname,
      { ...(lookupOptions as dns.LookupOptions), all: true },
      (error, addresses) => {
        if (error) {
          callback(error, addresses);
          return;
        }
        const list = Array.isArray(addresses) ? addresses : [addresses];
        const first: LookupEntry | undefined = list[0];
        if (!first) {
          callback(new SsrfError(`no addresses resolved for ${hostname}`), "");
          return;
        }
        if (!factoryOptions.disableIpCheck) {
          for (const entry of list) {
            if (isBlockedIp(entry.address)) {
              callback(
                new SsrfError(`DNS resolved to blocked IP: ${entry.address}`),
                entry.address,
              );
              return;
            }
          }
        }
        // คืน address แรกที่ผ่าน — net.connect จะ connect กับ IP นี้
        if ((lookupOptions as { all?: boolean } | undefined)?.all) {
          callback(null, list);
        } else {
          callback(null, first.address, first.family);
        }
      },
    );
  };
}

export interface SsrfFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  /** override ใน test เพื่อใช้ http กับ mock server */
  schemes?: string[];
  allowlist?: string[];
  redirectLimit?: number;
  timeoutMs?: number;
  /** test-only: ปิดการตรวจ IP (mock server อยู่บน loopback ซึ่งถูกบล็อกตามปกติ) */
  disableIpCheck?: boolean;
}

function validateUrl(rawUrl: string, schemes: string[], allowlist: string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`invalid URL: ${rawUrl.slice(0, 100)}`);
  }
  if (!schemes.includes(url.protocol.replace(":", ""))) {
    throw new SsrfError(`scheme not allowed: ${url.protocol}`);
  }
  if (!hostAllowed(url.hostname, allowlist)) {
    throw new SsrfError(`host not allowed: ${url.hostname}`);
  }
  return url;
}

/**
 * fetch แบบกำหนดเอง: allowlist + safeLookup ทุก hop + redirect ≤ N (security.md §8.3–8.4)
 * คืน response ดิบของ node — caller ต้อง pipe/destroy stream เอง
 */
export async function ssrfFetch(
  rawUrl: string,
  options: SsrfFetchOptions = {},
): Promise<SafeUpstreamResponse> {
  const schemes = options.schemes ?? ["https"];
  const allowlist =
    options.allowlist ?? parseAllowlist(process.env.SSRF_HOST_ALLOWLIST);
  const redirectLimit = options.redirectLimit ?? 3;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const url = validateUrl(rawUrl, schemes, allowlist);
  const lookup = safeLookupFactory({ disableIpCheck: options.disableIpCheck });

  function requestOnce(
    currentUrl: URL,
    redirectsLeft: number,
  ): Promise<SafeUpstreamResponse> {
    return new Promise((resolve, reject) => {
      const transport = currentUrl.protocol === "https:" ? https : http;
      const request = transport.request(
        currentUrl,
        {
          method: options.method ?? "GET",
          headers: options.headers,
          lookup: lookup as unknown as http.RequestOptions["lookup"],
          servername: currentUrl.hostname, // SNI ตาม hostname จริง
          timeout: timeoutMs,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = response.headers.location;
            response.resume(); // ทิ้ง body ของ redirect
            if (!location || redirectsLeft <= 0) {
              reject(new SsrfError("too many redirects or missing Location"));
              return;
            }
            try {
              const next = validateUrl(
                new URL(location, currentUrl).toString(),
                schemes,
                allowlist,
              );
              requestOnce(next, redirectsLeft - 1).then(resolve, reject);
            } catch (redirectError) {
              reject(redirectError);
            }
            return;
          }
          resolve({ statusCode: status, headers: response.headers, stream: response });
        },
      );
      request.on("timeout", () => {
        request.destroy(new SsrfError("upstream connection timeout"));
      });
      request.on("error", reject);
      request.end();
    });
  }

  return requestOnce(url, redirectLimit);
}
