/**
 * Smoke test กับ Lavalink container จริง — roadmap Phase 2
 * ใช้: docker compose up -d lavalink && pnpm --filter @musicplayer/server exec tsx scripts/smoke-lavalink.ts [query]
 */
import { LavalinkClient } from "../src/services/lavalink/LavalinkClient.js";

const baseUrl = process.env.LAVALINK_URL ?? "http://localhost:2333";
const password = process.env.LAVALINK_PASSWORD ?? "youshallnotpass";
const query = process.argv[2] ?? "daft punk";

async function main(): Promise<number> {
  const client = new LavalinkClient({ baseUrl, password });
  let failed = false;

  console.log(`[1/3] GET ${baseUrl}/v4/info`);
  const info = await client.getInfo();
  console.log(`  version: ${info.version.semver}`);
  console.log(`  sourceManagers: ${info.sourceManagers.join(", ")}`);
  console.log(
    `  plugins: ${info.plugins.map((p) => `${p.name}@${p.version}`).join(", ")}`,
  );
  const pluginNames = info.plugins.map((p) => p.name.toLowerCase());
  if (!pluginNames.some((n) => n.includes("youtube"))) {
    console.error("  FAIL: youtube plugin ไม่ได้โหลด");
    failed = true;
  }

  console.log(`[2/3] loadtracks ytsearch:"${query}"`);
  const yt = await client.loadTracks(`ytsearch:${query}`);
  if (yt.loadType === "search" || yt.loadType === "track") {
    const tracks = yt.loadType === "search" ? yt.data : [yt.data];
    console.log(`  loadType=${yt.loadType}, ${tracks.length} tracks`);
    console.log(
      `  first: "${tracks[0]?.info.title}" — ${tracks[0]?.info.author} (${tracks[0]?.info.sourceName})`,
    );
    if (tracks.length === 0) {
      console.error("  FAIL: ytsearch ไม่คืนผล");
      failed = true;
    }
  } else {
    console.error(`  FAIL: loadType=${yt.loadType}`, yt.data);
    failed = true;
  }

  console.log(`[3/3] loadtracks spsearch:"${query}"`);
  const sp = await client.loadTracks(`spsearch:${query}`);
  if (sp.loadType === "search" || sp.loadType === "track") {
    const tracks = sp.loadType === "search" ? sp.data : [sp.data];
    console.log(`  loadType=${sp.loadType}, ${tracks.length} tracks`);
    console.log(
      `  first: "${tracks[0]?.info.title}" — ${tracks[0]?.info.author} (album: ${String(
        tracks[0]?.pluginInfo?.["albumName"] ?? "-",
      )})`,
    );
    if (tracks.length === 0) {
      console.error("  FAIL: spsearch ไม่คืนผล");
      failed = true;
    }
  } else if (sp.loadType === "error") {
    console.error("  FAIL (spsearch):", sp.data.message);
    console.error(
      "  → ต้องตั้ง SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET ใน .env แล้ว `docker compose up -d lavalink` ใหม่",
    );
    failed = true;
  } else {
    console.error(`  FAIL: loadType=${sp.loadType}`);
    failed = true;
  }

  return failed ? 1 : 0;
}

main()
  .then((code) => {
    console.log(code === 0 ? "SMOKE PASS" : "SMOKE FAIL");
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error("SMOKE FAIL:", error);
    process.exit(1);
  });
