import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { createSearchService } from "../services/SearchService.js";
import { LavalinkUnavailableError } from "../services/lavalink/errors.js";
import type { LavalinkTrack, LoadResult } from "../services/lavalink/types.js";
import type { TrackUpsert } from "../repositories/tracks.repo.js";

/** fixture ตาม shape Lavalink v4 จริง (lavalink.md §6.1) */
function track(overrides?: {
  title?: string;
  identifier?: string;
  sourceName?: string;
  isStream?: boolean;
  pluginInfo?: Record<string, unknown>;
}): LavalinkTrack {
  return {
    encoded: "QWJjRGVmSW5n",
    info: {
      identifier: overrides?.identifier ?? "dQw4w9WgXcQ",
      isSeekable: !(overrides?.isStream ?? false),
      author: "Artist Name",
      length: 213_000,
      isStream: overrides?.isStream ?? false,
      position: 0,
      title: overrides?.title ?? "Song Title",
      uri: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      artworkUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      isrc: null,
      sourceName: overrides?.sourceName ?? "youtube",
    },
    pluginInfo: overrides?.pluginInfo ?? {},
  };
}

function makeHarness(loadResult: LoadResult) {
  const loadTracks = vi.fn(async () => loadResult);
  const upserts: TrackUpsert[] = [];
  const upsertTrack = vi.fn(async (t: TrackUpsert) => {
    upserts.push(t);
    return { id: `11111111-2222-3333-4444-55555555555${upserts.length % 10}` };
  });

  const search = createSearchService({
    lavalink: { loadTracks },
    upsertTrack,
  }).search;

  const app = buildApp(
    {
      CORS_ORIGIN: undefined,
      RESOLVER_URL: "http://unused",
      LAVALINK_URL: "http://unused",
      LAVALINK_PASSWORD: "x",
      JWT_SECRET: "test-jwt-secret-with-32-chars-min!!",
      REFRESH_SECRET: "test-refresh-secret-32-chars-min!!",
    },
    { search },
  );

  return { app, loadTracks, upsertTrack, upserts };
}

describe("GET /api/v1/search — contract ครบ 5 loadTypes", () => {
  it("loadType=track → 200 TrackDTO 1 ตัว + upsert 1 (ไม่มี field infra หลุด)", async () => {
    const { app, upserts } = makeHarness({ loadType: "track", data: track() });
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=test" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tracks).toHaveLength(1);
    expect(body.sources).toEqual({ available: ["yt"], degraded: [] });
    expect(body.tracks[0]).toEqual({
      id: expect.any(String),
      title: "Song Title",
      artist: "Artist Name",
      album: null,
      durationMs: 213_000,
      isStream: false,
      isSeekable: true,
      artworkUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      sourceName: "youtube",
      isLiked: false,
    });
    // stream_url / lavalink_encoded ห้ามออกไปให้ client (database.md §2.2)
    expect(res.body).not.toContain("lavalinkEncoded");
    expect(res.body).not.toContain("lavalink_encoded");
    expect(res.body).not.toContain("streamUrl");
    expect(upserts[0]?.sourceIdentifier).toBe("dQw4w9WgXcQ");
    expect(upserts[0]?.lavalinkEncoded).toBe("QWJjRGVmSW5n"); // เก็บใน DB แต่ไม่ออกไป
    await app.close();
  });

  it("loadType=search → 200 หลายเพลง + upsert ครบ", async () => {
    const data = [
      track({ title: "A", identifier: "a" }),
      track({ title: "B", identifier: "b" }),
      track({ title: "C", identifier: "c" }),
    ];
    const { app, upserts } = makeHarness({ loadType: "search", data });
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=test" });

    expect(res.statusCode).toBe(200);
    expect(res.json().tracks).toHaveLength(3);
    expect(upserts).toHaveLength(3);
    await app.close();
  });

  it("loadType=playlist → 200 flatten จาก data.tracks", async () => {
    const tracks = [
      track({ title: "P1", identifier: "p1" }),
      track({ title: "P2", identifier: "p2" }),
    ];
    const { app } = makeHarness({
      loadType: "playlist",
      data: { info: { name: "My Playlist", selectedTrack: -1 }, tracks },
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=playlist" });

    expect(res.statusCode).toBe(200);
    expect(res.json().tracks.map((t: { title: string }) => t.title)).toEqual([
      "P1",
      "P2",
    ]);
    await app.close();
  });

  it("loadType=empty → 200 tracks [] + ไม่มี upsert", async () => {
    const { app, upsertTrack } = makeHarness({ loadType: "empty", data: null });
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=zzzz" });

    expect(res.statusCode).toBe(200);
    expect(res.json().tracks).toEqual([]);
    expect(upsertTrack).not.toHaveBeenCalled();
    await app.close();
  });

  it("loadType=error → 503 UPSTREAM_UNAVAILABLE + degraded มี source ที่ขอ", async () => {
    const { app } = makeHarness({
      loadType: "error",
      data: { message: "Something broke", severity: "FAULT" },
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=test" });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(body.error.details.sources.degraded).toEqual(["yt"]);
    await app.close();
  });

  it("spsearch → album จาก pluginInfo.albumName + source mapping ถูก", async () => {
    const { app, loadTracks } = makeHarness({
      loadType: "search",
      data: [track({ sourceName: "spotify", pluginInfo: { albumName: "Discovery" } })],
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=one%20more%20time&source=sp",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sources.available).toEqual(["sp"]);
    expect(res.json().tracks[0].album).toBe("Discovery");
    expect(loadTracks).toHaveBeenCalledWith("spsearch:one more time");
    await app.close();
  });

  it("source=ytm → identifier เริ่มด้วย ytmsearch:", async () => {
    const { app, loadTracks } = makeHarness({ loadType: "empty", data: null });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=test&source=ytm",
    });

    expect(res.statusCode).toBe(200);
    expect(loadTracks).toHaveBeenCalledWith("ytmsearch:test");
    await app.close();
  });

  it("limit ตัดผลและ upsert เฉพาะที่ส่งกลับ", async () => {
    const data = Array.from({ length: 12 }, (_, i) =>
      track({ title: `T${i}`, identifier: `id-${i}` }),
    );
    const { app, upserts } = makeHarness({ loadType: "search", data });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=test&limit=5",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tracks).toHaveLength(5);
    expect(upserts).toHaveLength(5);
    await app.close();
  });

  it.each([
    ["/api/v1/search", "ไม่มี q"],
    ["/api/v1/search?q=%20%20", "q ว่างหลัง trim"],
    ["/api/v1/search?q=test&limit=0", "limit น้อยกว่า 1"],
    ["/api/v1/search?q=test&limit=99", "limit มากกว่า 50"],
    ["/api/v1/search?q=test&source=dz", "source ไม่รู้จัก"],
  ])("validation: %s (%s) → 400 VALIDATION_ERROR", async (url: string) => {
    const { app } = makeHarness({ loadType: "empty", data: null });
    const res = await app.inject({ method: "GET", url });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("q ยาวเกิน 200 → 400", async () => {
    const { app } = makeHarness({ loadType: "empty", data: null });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/search?q=${"x".repeat(201)}`,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("fail-soft: lavalink โยน UnavailableError → 503 (ไม่ 500)", async () => {
    const app = buildApp(
      {
        CORS_ORIGIN: undefined,
        RESOLVER_URL: "http://unused",
        LAVALINK_URL: "http://unused",
        LAVALINK_PASSWORD: "x",
        JWT_SECRET: "test-jwt-secret-with-32-chars-min!!",
        REFRESH_SECRET: "test-refresh-secret-32-chars-min!!",
      },
      {
        search: createSearchService({
          lavalink: {
            loadTracks: async () => {
              throw new LavalinkUnavailableError("Lavalink circuit breaker is open");
            },
          },
          upsertTrack: async () => ({ id: "x" }),
        }).search,
      },
    );
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=test" });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("UPSTREAM_UNAVAILABLE");
    await app.close();
  });
});
