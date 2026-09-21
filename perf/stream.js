/* eslint-disable no-undef -- __VU/options เป็น globals ของ k6 runtime */
/**
 * k6 — /stream load test (roadmap Phase 13: load test /stream)
 * แต่ละ VU สมัคร account เอง → search → เริ่มเพลง (player/play) → ดาวน์โหลด stream
 * ชิ้นแรกแบบ Range (เลียนแบบ audio element) → วัด TTFB/ความสำเร็จ
 * รัน: docker run --rm --network musicplayer_default -v "$PWD/perf:/perf" grafana/k6 run /perf/stream.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const ERROR_RATE = new Rate("errors");
const FIRST_BYTE = new Trend("stream_first_byte_ms");

export const options = {
  // load test /stream — 20 VUs (ต่ำกว่า cap ที่ design ไว้แต่พอวัดเสถียรภาพ)
  vus: 20,
  duration: "45s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    stream_first_byte_ms: ["p(95)<2000"], // "play < 2 s" — first byte ของ stream
  },
};

export function setup() {
  // seed ครั้งเดียว: search หา trackId — VU แต่ละตัวจะ register account ของตัวเองใน
  // first iteration (stream guard: 60 req/min + ≤ 2 concurrent ต่อ user — ต่อ VU = 1)
  const seed = http.post(
    "http://web/api/v1/auth/register",
    JSON.stringify({
      email: `k6-seed-${Date.now()}@perf.test`,
      password: "perf-password-123",
      displayName: "k6",
    }),
    { headers: { "content-type": "application/json" } },
  );
  check(seed, { registered: (r) => r.status === 200 });
  const token = seed.json("accessToken");
  const search = http.get("http://web/api/v1/search?q=daft%20punk", {
    headers: { authorization: `Bearer ${token}` },
  });
  check(search, { searched: (r) => r.status === 200 });
  const tracks = search.json("tracks") ?? [];
  if (tracks.length === 0) {
    throw new Error("no search results — Lavalink/YouTube ไม่พร้อม?");
  }
  return { trackId: tracks[0].id };
}

const vuAuth = {};

function authFor(vu) {
  if (!vuAuth[vu]) {
    const reg = http.post(
      "http://web/api/v1/auth/register",
      JSON.stringify({
        email: `k6-${vu}-${Date.now()}@perf.test`,
        password: "perf-password-123",
        displayName: "k6",
      }),
      { headers: { "content-type": "application/json" } },
    );
    check(reg, { registered: (r) => r.status === 200 });
    // refresh token ไม่มีใน body — อยู่ใน Set-Cookie (httpOnly cookie ของ flow เดิม)
    const setCookie = reg.headers["Set-Cookie"] ?? "";
    const refreshToken = (setCookie.match(/refresh_token=([^;]+)/) ?? [])[1] ?? "";
    check(refreshToken, { "got refresh cookie": (v) => v.length > 0 });
    vuAuth[vu] = { refreshToken };
  }
  return vuAuth[vu];
}

export default function (data) {
  const auth = authFor(__VU);
  // เลียนแบบ audio element: auth ด้วย refresh cookie (security.md §8.6 — browser แนบเอง)
  // + request ชิ้นแรกด้วย Range (server ตอบ 206/200 พร้อม bytes)
  const res = http.get(`http://web/api/v1/stream/${data.trackId}`, {
    headers: {
      cookie: `refresh_token=${auth.refreshToken}`,
      range: "bytes=0-65535",
    },
  });
  FIRST_BYTE.add(res.timings.waiting);
  check(res, {
    "stream 200/206": (r) => r.status === 200 || r.status === 206,
    "got audio bytes": (r) => r.body !== null && r.body.length > 0,
  });
  if (res.status !== 200 && res.status !== 206) ERROR_RATE.add(1);
  sleep(2); // stream จริงป้อนเสียงต่อเนื่อง ๆ — ~30 req/min/user < 60/min guard
}
