import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { createSearchService } from "../services/SearchService.js";
import { LavalinkUnavailableError } from "../services/lavalink/errors.js";
import { signJwt } from "../services/auth/jwt.js";
import type { LavalinkTrack, LoadResult } from "../services/lavalink/types.js";
import type { TrackUpsert } from "../repositories/tracks.repo.js";
import type { TrackDTO as TrackDTODto } from "@musicplayer/shared";

const JWT_SECRET = "test-jwt-secret-with-32-chars-min!!";
const USER_ID = "99999999-9999-4999-8999-999999999999";

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

/** library track DTO (shape TrackDTO — id uuid) */
function libTrack(id: string, title: string): TrackDTODto {
  return {
    id,
    title,
    artist: "Artist Name",
    album: null,
    durationMs: 213_000,
    isStream: false,
    isSeekable: true,
    artworkUrl: null,
    sourceName: "youtube",
    isLiked: false,
  };
}

const AUTH = { authorization: `Bearer ${signJwt(USER_ID, JWT_SECRET, 60_000)}` };

interface HarnessOptions {
  loadResult?: LoadResult;
  loadError?: Error;
  library?: TrackDTODto[] | Error;
}

function makeHarness(options: HarnessOptions = {}) {
  const loadTracks = vi.fn(async () => {
    if (options.loadError) throw options.loadError;
    return options.loadResult ?? ({ loadType: "empty", data: null } as LoadResult);
  });
  const libraryResult = options.library ?? [];
  const searchLibrary = vi.fn(async () => {
    if (libraryResult instanceof Error) throw libraryResult;
    return libraryResult;
  });
  const upserts: TrackUpsert[] = [];
  const upsertTrack = vi.fn(async (t: TrackUpsert) => {
    upserts.push(t);
    // mock: id คงที่ต่อ identifier (charCode sum % 10) — dedupe กับ library เทียบผ่าน tail นี้
    const n =
      [...t.sourceIdentifier].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 10;
    return { id: `11111111-2222-3333-4444-55555555555${n}` };
  });

  const search = createSearchService({
    lavalink: { loadTracks },
    upsertTrack,
    searchLibrary,
  }).search;

  const app = buildApp(
    {
      CORS_ORIGIN: undefined,
      RESOLVER_URL: "http://unused",
      LAVALINK_URL: "http://unused",
      LAVALINK_PASSWORD: "x",
      JWT_SECRET,
      REFRESH_SECRET: "test-refresh-secret-32-chars-min!!",
    },
    { search },
  );

  return { app, loadTracks, searchLibrary, upsertTrack, upserts };
}

function get(url: string) {
  return { method: "GET" as const, url, headers: AUTH };
}

describe("GET /api/v1/search — contract ครบ 5 loadTypes", () => {
  it("loadType=track → 200 TrackDTO 1 ตัว + upsert 1 (ไม่มี field infra หลุด)", async () => {
    const { app, upserts } = makeHarness({
      loadResult: { loadType: "track", data: track() },
    });
    const res = await app.inject(get("/api/v1/search?q=test"));

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
    const { app, upserts } = makeHarness({ loadResult: { loadType: "search", data } });
    const res = await app.inject(get("/api/v1/search?q=test"));

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
      loadResult: {
        loadType: "playlist",
        data: { info: { name: "My Playlist", selectedTrack: -1 }, tracks },
      },
    });
    const res = await app.inject(get("/api/v1/search?q=playlist"));

    expect(res.statusCode).toBe(200);
    expect(res.json().tracks.map((t: { title: string }) => t.title)).toEqual([
      "P1",
      "P2",
    ]);
    await app.close();
  });

  it("loadType=empty → 200 tracks [] + ไม่มี upsert", async () => {
    const { app, upsertTrack } = makeHarness({});
    const res = await app.inject(get("/api/v1/search?q=zzzz"));

    expect(res.statusCode).toBe(200);
    expect(res.json().tracks).toEqual([]);
    expect(upsertTrack).not.toHaveBeenCalled();
    await app.close();
  });

  it("loadType=error → 503 UPSTREAM_UNAVAILABLE + degraded มี source ที่ขอ (library ว่าง)", async () => {
    const { app } = makeHarness({
      loadResult: {
        loadType: "error",
        data: { message: "Something broke", severity: "FAULT" },
      },
    });
    const res = await app.inject(get("/api/v1/search?q=test"));

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(body.error.details.sources.degraded).toEqual(["yt"]);
    await app.close();
  });

  it("source=ytm → identifier เริ่มด้วย ytmsearch:", async () => {
    const { app, loadTracks } = makeHarness({});
    const res = await app.inject(get("/api/v1/search?q=test&source=ytm"));

    expect(res.statusCode).toBe(200);
    expect(loadTracks).toHaveBeenCalledWith("ytmsearch:test");
    await app.close();
  });

  it("limit ตัดผลและ upsert เฉพาะที่ส่งกลับ", async () => {
    const data = Array.from({ length: 12 }, (_, i) =>
      track({ title: `T${i}`, identifier: `id-${i}` }),
    );
    const { app, upserts } = makeHarness({ loadResult: { loadType: "search", data } });
    const res = await app.inject(get("/api/v1/search?q=test&limit=5"));

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
    ["/api/v1/search?q=test&offset=-1", "offset ติดลบ"],
    ["/api/v1/search?q=test&source=dz", "source ไม่รู้จัก"],
    ["/api/v1/search?q=test&source=sp", "source sp ถูกถอดออกแล้ว (ADR-009)"],
  ])("validation: %s (%s) → 400 VALIDATION_ERROR", async (url: string) => {
    const { app } = makeHarness({});
    const res = await app.inject(get(url));

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("q ยาวเกิน 200 → 400", async () => {
    const { app } = makeHarness({});
    const res = await app.inject(get(`/api/v1/search?q=${"x".repeat(201)}`));
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /api/v1/search — Phase 6 (auth + library merge + pagination)", () => {
  it("ไม่มี Bearer → 401 UNAUTHENTICATED", async () => {
    const { app } = makeHarness({});
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=test" });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
    await app.close();
  });

  it("merge: library มาก่อน remote + dedupe ตาม id + available มี library", async () => {
    // remote "id-9" → mock id tail = charCode sum % 10 = 7 (เดียวกับ library)
    const lib = [libTrack("11111111-2222-3333-4444-555555555557", "Song Title")];
    const { app } = makeHarness({
      // remote track identifier id-9 → mock คืน id ...559 เดียวกับ library = dedupe
      loadResult: {
        loadType: "search",
        data: [
          track({ title: "Song Title", identifier: "id-9" }),
          track({ title: "Other", identifier: "id-3" }),
        ],
      },
      library: lib,
    });
    const res = await app.inject(get("/api/v1/search?q=song"));

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tracks.map((t: { title: string }) => t.title)).toEqual([
      "Song Title",
      "Other",
    ]);
    expect(body.sources.available).toEqual(["library", "yt"]);
    await app.close();
  });

  it("offset ตัดหน้าจาก merged list (library ก่อน remote)", async () => {
    // tail 5 — ไม่ชน id-1 (9) / id-2 (8) กัน dedupe พลาด
    const lib = [libTrack("11111111-2222-3333-4444-555555555555", "Lib Song")];
    const { app } = makeHarness({
      loadResult: {
        loadType: "search",
        data: [
          track({ title: "R1", identifier: "id-1" }),
          track({ title: "R2", identifier: "id-2" }),
        ],
      },
      library: lib,
    });
    // page 2 (offset=1): เหลือ R1, R2
    const res = await app.inject(get("/api/v1/search?q=x&limit=1&offset=1"));

    expect(res.statusCode).toBe(200);
    expect(res.json().tracks.map((t: { title: string }) => t.title)).toEqual(["R1"]);
    await app.close();
  });

  it("fail-soft: lavalink ล่ม + library มีผล → 200 library + degraded:[yt]", async () => {
    const lib = [libTrack("11111111-2222-3333-4444-555555555551", "Lib Song")];
    const { app } = makeHarness({
      loadError: new LavalinkUnavailableError("Lavalink circuit breaker is open"),
      library: lib,
    });
    const res = await app.inject(get("/api/v1/search?q=test"));

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tracks.map((t: { title: string }) => t.title)).toEqual(["Lib Song"]);
    expect(body.sources).toEqual({ available: ["library"], degraded: ["yt"] });
    await app.close();
  });

  it("fail-soft: lavalink ล่ม + library ว่าง → 503 (เดิม)", async () => {
    const { app } = makeHarness({
      loadError: new LavalinkUnavailableError("Lavalink circuit breaker is open"),
    });
    const res = await app.inject(get("/api/v1/search?q=test"));

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("UPSTREAM_UNAVAILABLE");
    await app.close();
  });

  it("library error → degrade 'library' แต่ยังคืนผล remote", async () => {
    const { app, searchLibrary } = makeHarness({
      loadResult: {
        loadType: "search",
        data: [track({ title: "R1", identifier: "id-1" })],
      },
      library: new Error("pg down"),
    });
    const res = await app.inject(get("/api/v1/search?q=test"));

    expect(res.statusCode).toBe(200);
    expect(res.json().tracks.map((t: { title: string }) => t.title)).toEqual(["R1"]);
    expect(res.json().sources.available).toEqual(["yt"]);
    expect(searchLibrary).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rate limit: เกิน 30 req/min/user → 429 RATE_LIMITED", async () => {
    const { app } = makeHarness({});
    // ก่อนหน้าใช้ 30 ครั้งให้ครบ window — ครั้งที่ 31 ต้องโดน
    for (let i = 0; i < 30; i++) {
      const res = await app.inject(get(`/api/v1/search?q=q${i}`));
      expect(res.statusCode).toBe(200);
    }
    const res = await app.inject(get("/api/v1/search?q=over"));
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("RATE_LIMITED");
    await app.close();
  });
});
