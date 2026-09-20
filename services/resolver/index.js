/**
 * Resolver placeholder — Phase 1 เท่านั้น
 * Resolver จริง (yt-dlp, trackId → stream URL) implement ใน Phase 3 ตาม roadmap
 * หน้าที่ตอนนี้: ยืนยัน topology ของ compose ว่าครบและ server อ้าง RESOLVER_URL ได้
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 3002);

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: "resolver" }));
    return;
  }
  res.writeHead(503);
  res.end(
    JSON.stringify({
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "resolver not implemented (Phase 3)",
      },
    }),
  );
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`resolver placeholder listening on :${PORT}`);
});
