/* eslint-disable no-undef -- __VU/options เป็น globals ของ k6 runtime */
/**
 * k6 — search performance (roadmap Phase 13: P95 < 2 s)
 * รัน: docker run --rm --network musicplayer_default -v "$PWD/perf:/perf" grafana/k6 run /perf/search.js
 * (target ผ่าน nginx web:8080 — same path กับที่ client ใช้จริง)
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const ERROR_RATE = new Rate("errors");

export const options = {
  // ระบบส่วนตัว 1–5 users — profile เบาแต่ต้องผ่าน P95
  vus: 5,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{scenario:search}": ["p(95)<2000"],
  },
};

export function setup() {
  // 1 account ต่อ VU — search จำกัด 30 req/min/user (api.md §12) ต่อ VU จึงไม่โดน 429
  const tokens = [];
  const stamp = Date.now();
  for (let i = 0; i < options.vus; i++) {
    const res = http.post(
      "http://web/api/v1/auth/register",
      JSON.stringify({
        email: `k6-${stamp}-${i}@perf.test`,
        password: "perf-password-123",
        displayName: "k6",
      }),
      { headers: { "content-type": "application/json" } },
    );
    check(res, { registered: (r) => r.status === 200 });
    tokens.push(res.json("accessToken"));
  }
  return { tokens };
}

const QUERIES = ["daft punk", "one more time", "rick astley", "queen"];

export default function (data) {
  const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const res = http.get(`http://web/api/v1/search?q=${encodeURIComponent(q)}`, {
    headers: { authorization: `Bearer ${data.tokens[__VU - 1]}` },
    tags: { scenario: "search" },
  });
  check(res, { "search 200": (r) => r.status === 200 });
  if (res.status !== 200) ERROR_RATE.add(1);
  sleep(2.5); // ต่ำกว่า 30 req/min/user ของ search guard
}
