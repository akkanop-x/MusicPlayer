/**
 * Resolver service — docs/audio-pipeline.md §2/§3.1, ADR-007/008
 * สิ่งเดียวที่รู้จัก stream URL จริงของ YouTube: identifier → stream URL อายุสั้น (IP-bound)
 * แยก container เพื่อ isolate CPU/deps + อัปเดตง่ายเมื่อ YouTube เปลี่ยนกลไก
 */
import { execFile } from "node:child_process";
import http from "node:http";

const PORT = Number(process.env.PORT ?? 3002);
const CACHE_TTL_MS = 60_000; // stream URL cache — audio-pipeline.md §4 (URL จริงหมดอายุในไม่กี่นาที)
const EXTRACT_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_EXTRACTS = 2;

let activeExtracts = 0;
const cache = new Map(); // key: source:identifier -> { expiresAt, payload }
const queue = [];

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

/** ext → content-type ที่ browser เล่นได้ (audio-pipeline.md §3.2 — ไม่ transcode) */
function contentTypeForExt(ext) {
  switch (ext) {
    case "webm":
      return "audio/webm";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "opus":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

function apiError(res, code, message) {
  send(res, code === "TRACK_UNPLAYABLE" ? 422 : 503, { error: { code, message } });
}

/** รัน yt-dlp แล้วเลือก format เสียงที่ดีที่สุดที่ proxy ผ่าน http ได้ */
function extract(identifier) {
  const url = `https://www.youtube.com/watch?v=${identifier}`;
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      [
        "--no-playlist",
        "--no-warnings",
        "-f",
        "bestaudio[protocol^=http][acodec!=none]/bestaudio[protocol^=http]/bestaudio",
        "-J",
        url,
      ],
      { timeout: EXTRACT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          const info = JSON.parse(stdout);
          resolve({
            streamUrl: info.url,
            contentType: contentTypeForExt(info.ext),
            durationMs:
              typeof info.duration === "number" ? Math.round(info.duration * 1000) : 0,
            genres: genresFor(info),
          });
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

/** จำกัด concurrent extractions — เกินจากนั้นเข้าคิว (กัน yt-dlp กิน CPU ทั้งเครื่อง) */
function extractLimited(identifier) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (activeExtracts >= MAX_CONCURRENT_EXTRACTS) return false;
      activeExtracts++;
      extract(identifier)
        .then(resolve, reject)
        .finally(() => {
          activeExtracts--;
          setImmediate(runNext);
        });
      return true;
    };
    if (!attempt()) queue.push(attempt);
  });
}

function runNext() {
  while (queue.length > 0) {
    const attempt = queue.shift();
    if (attempt()) break;
  }
}

/** genre จาก metadata ของ YouTube เอง (categories + tags) — เก็บดิบ lowercase/trim, จำกัด 15 ค่า */
function genresFor(info) {
  const categories = Array.isArray(info.categories) ? info.categories : [];
  const tags = Array.isArray(info.tags) ? info.tags : [];
  const seen = new Set();
  const genres = [];
  for (const raw of [...categories, ...tags]) {
    if (typeof raw !== "string") continue;
    const value = raw.trim().toLowerCase();
    if (value.length === 0 || value.length > 50 || seen.has(value)) continue;
    seen.add(value);
    genres.push(value);
    if (genres.length >= 15) break;
  }
  return genres;
}

function classifyExtractError(error) {
  const message = String(error?.message ?? error);
  if (
    /Private video|Sign in to confirm|members-only|unavailable|removed by the uploader|age/i.test(
      message,
    )
  ) {
    return "TRACK_UNPLAYABLE";
  }
  return "UPSTREAM_UNAVAILABLE";
}

async function handleResolve(res, query) {
  const identifier = query.get("identifier") ?? "";
  const source = query.get("source") ?? "youtube";

  if (source !== "youtube") {
    return apiError(
      res,
      "TRACK_UNPLAYABLE",
      `resolver does not support source '${source}'`,
    );
  }
  if (!YOUTUBE_ID_RE.test(identifier)) {
    return apiError(res, "TRACK_UNPLAYABLE", "invalid youtube identifier");
  }

  const key = `${source}:${identifier}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return send(res, 200, hit.payload);
  }
  if (hit) cache.delete(key);

  try {
    const payload = await extractLimited(identifier);
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    send(res, 200, payload);
  } catch (error) {
    console.error("resolve failed:", error?.message ?? error);
    apiError(res, classifyExtractError(error), "failed to resolve stream");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/health") {
    return send(res, 200, { ok: true, service: "resolver" });
  }
  if (url.pathname === "/resolve") {
    handleResolve(res, url.searchParams).catch((error) => {
      console.error("handleResolve crashed:", error);
      apiError(res, "UPSTREAM_UNAVAILABLE", "resolver internal error");
    });
    return;
  }
  send(res, 404, {
    error: {
      code: "NOT_FOUND",
      message: `Route ${req.method}:${url.pathname} not found`,
    },
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`resolver listening on :${PORT}`);
});
