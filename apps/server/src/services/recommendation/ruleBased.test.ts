/**
 * RuleBasedProvider v2 — recommendation.md §2.1/§2.1.1/§2.2/§3/§7/§9
 * genre constraint เป็น hard filter, scoring + weighted random (rng inject ให้ deterministic),
 * คลาย filter ทีละชั้น (recent/skipped → genre ท้ายสุด), home feed (cold start → [])
 */
import { describe, expect, it, vi } from "vitest";
import {
  createRuleBasedProvider,
  normalizeGenre,
  titleTokens,
  type ProviderQueries,
} from "./ruleBased.js";
import type { RadioCandidate } from "./provider.js";

function track(id: string, over: Partial<RadioCandidate> = {}): RadioCandidate {
  return {
    id,
    title: `t-${id}`,
    artist: `a-${id}`,
    album: null,
    durationMs: 1000,
    isStream: false,
    isSeekable: true,
    artworkUrl: null,
    sourceName: "youtube",
    isLiked: false,
    genres: [],
    ...over,
  };
}

/** rng = 0 → weightedPick เลือกตัวคะแนนสูงสุดเสมอ (tie → ตัวแรก) = deterministic */
const rng0 = () => 0;

function fakeQueries(over: Partial<ProviderQueries> = {}): ProviderQueries {
  return {
    findSeedTracks: vi.fn(async (ids: string[]) => ids.map((id) => track(id))),
    findSameGenreTracks: vi.fn(async () => [] as RadioCandidate[]),
    findSameArtistTracks: vi.fn(async () => [] as RadioCandidate[]),
    findSameAlbumTracks: vi.fn(async () => [] as RadioCandidate[]),
    findTopPlayedTracks: vi.fn(async () => [] as RadioCandidate[]),
    findLikedTracks: vi.fn(async () => [] as RadioCandidate[]),
    findRecentlyPlayedTracks: vi.fn(async () => [] as RadioCandidate[]),
    findRecentlyPlayedTrackIds: vi.fn(async () => [] as string[]),
    findSkippedTrackIds: vi.fn(async () => [] as string[]),
    findLastCompletedTracks: vi.fn(async () => [] as RadioCandidate[]),
    findSimilarTitleTracks: vi.fn(async () => [] as RadioCandidate[]),
    ...over,
  };
}

const ids = (ts: Array<{ id: string }>) => ts.map((t) => t.id);

describe("normalizeGenre", () => {
  it("lowercase + ตัดขีด/ช่องว่าง — 'Hip-Hop' = 'hip hop'", () => {
    expect(normalizeGenre("Hip-Hop")).toBe(normalizeGenre("hip hop"));
  });

  it("titleTokens: เฉพาะ token ยาว ≥ 4", () => {
    expect(titleTokens("One More Time (HQ)")).toEqual(["more", "time"]);
  });
});

describe("getRadioTracks", () => {
  it("ไม่มี seed / ghost seed / limit ≤ 0 → []", async () => {
    const q = fakeQueries({
      findSeedTracks: vi.fn(async (ids: string[]) =>
        ids.filter((id) => id === "seed").map((id) => track(id)),
      ),
    });
    const p = createRuleBasedProvider(q);
    expect(await p.getRadioTracks({}, new Set(), 5)).toEqual([]);
    expect(await p.getRadioTracks({ trackId: "ghost" }, new Set(), 5)).toEqual([]);
    expect(await p.getRadioTracks({ trackId: "seed" }, new Set(), 0)).toEqual([]);
  });

  it("genre constraint ตัด candidate ต่างแนว (แม้ same artist) + exclude ถูกส่งให้ query", async () => {
    const q = fakeQueries({
      findSeedTracks: vi.fn(async () => [track("seed", { genres: ["Rock"] })]),
      findSameGenreTracks: vi.fn(async (_g: string[], exclude: string[]) => {
        expect(exclude).toContain("seed");
        expect(exclude).toContain("gone");
        return [track("in", { genres: ["Rock"] })];
      }),
      findSameArtistTracks: vi.fn(async () => [
        track("same", { genres: ["Pop"] }), // ต่างแนว → ถูกตัด
      ]),
    });
    const p = createRuleBasedProvider(q, { rng: rng0 });
    const out = await p.getRadioTracks(
      { trackId: "seed", userId: "u1" },
      new Set(["gone"]),
      5,
    );
    expect(ids(out)).toEqual(["in"]);
  });

  it("normalize ข้ามแหล่ง: seed genre 'Hip-Hop' เจอ candidate genre 'hip hop'", async () => {
    const q = fakeQueries({
      findSeedTracks: vi.fn(async () => [track("seed", { genres: ["Hip-Hop"] })]),
      findSameGenreTracks: vi.fn(async (genres: string[]) => {
        expect(genres).toEqual(["hiphop"]);
        return [track("h1", { genres: ["hip hop"] })];
      }),
    });
    const out = await createRuleBasedProvider(q, { rng: rng0 }).getRadioTracks(
      { trackId: "seed" },
      new Set(),
      5,
    );
    expect(ids(out)).toEqual(["h1"]);
  });

  it("seed ไม่มี genre → ใช้ taste genres จากเพลงเล่นจบล่าสุด (§2.1.1 fallback)", async () => {
    const q = fakeQueries({
      findSeedTracks: vi.fn(async () => [track("seed")]),
      findLastCompletedTracks: vi.fn(async () => [
        track("h1", { genres: ["Hip-Hop"] }),
      ]),
      findSameGenreTracks: vi.fn(async (genres: string[]) => {
        expect(genres).toEqual(["hiphop"]);
        return [track("j1", { genres: ["Hip Hop"] })];
      }),
    });
    const p = createRuleBasedProvider(q, { rng: rng0 });
    const out = await p.getRadioTracks({ trackId: "seed", userId: "u1" }, new Set(), 5);
    expect(ids(out)).toEqual(["j1"]);
  });

  it("seed ไม่มี genre + ไม่มี taste → คลาย constraint ใช้ same artist + warn log", async () => {
    const logs: string[] = [];
    const q = fakeQueries({
      findSeedTracks: vi.fn(async () => [track("seed")]),
      findSameArtistTracks: vi.fn(async () => [track("sa")]),
    });
    const p = createRuleBasedProvider(q, { rng: rng0, log: (m) => logs.push(m) });
    const out = await p.getRadioTracks({ trackId: "seed" }, new Set(), 5);
    expect(ids(out)).toEqual(["sa"]);
    expect(q.findSameGenreTracks).not.toHaveBeenCalled();
    expect(logs.join(" ")).toContain("คลาย genre constraint");
  });

  it("ไม่มี userId → ไม่ยิง query ส่วน user", async () => {
    const q = fakeQueries({
      findSeedTracks: vi.fn(async () => [track("seed", { genres: ["Rock"] })]),
      findSameGenreTracks: vi.fn(async () => [track("g1", { genres: ["Rock"] })]),
    });
    const out = await createRuleBasedProvider(q, { rng: rng0 }).getRadioTracks(
      { trackId: "seed" },
      new Set(),
      3,
    );
    expect(ids(out)).toEqual(["g1"]);
    expect(q.findTopPlayedTracks).not.toHaveBeenCalled();
    expect(q.findLikedTracks).not.toHaveBeenCalled();
  });

  it("scoring §2.2: artist ซ้ำเกิน 2 ตัว → −4 แพ้ต่างศิลปินคะแนนเท่ากัน", async () => {
    const pool = [
      track("s1", { artist: "a1", genres: ["Rock"] }),
      track("s2", { artist: "a1", genres: ["Rock"] }),
      track("s3", { artist: "a1", genres: ["Rock"] }),
      track("t1", { artist: "a2", genres: ["Rock"] }),
    ];
    const out = await createRuleBasedProvider(
      fakeQueries({
        findSeedTracks: vi.fn(async () => [track("seed", { genres: ["Rock"] })]),
        findSameGenreTracks: vi.fn(async () => pool),
      }),
      { rng: rng0 },
    ).getRadioTracks({ trackId: "seed" }, new Set(), 3);
    // รอบที่ 3: s3 (artist a1 ครบ 2 แล้ว → −4) แพ้ t1 — ได้ [s1, s2, t1] ไม่ใช่ [s1, s2, s3]
    expect(ids(out)).toEqual(["s1", "s2", "t1"]);
  });

  it("recently played (7 วัน) ได้ +3 และไม่ได้ recencyBoost", async () => {
    const out = await createRuleBasedProvider(
      fakeQueries({
        findSeedTracks: vi.fn(async () => [track("seed", { genres: ["Rock"] })]),
        findSameGenreTracks: vi.fn(async () => [
          track("s1", { genres: ["Rock"] }),
          track("o1", { artist: "a2", genres: ["Rock"] }),
        ]),
        findRecentlyPlayedTracks: vi.fn(async () => [
          track("o1", { artist: "a2", genres: ["Rock"] }),
        ]),
      }),
      { rng: rng0 },
    ).getRadioTracks({ trackId: "seed", userId: "u1" }, new Set(), 2);
    // o1: 6 + 3 (recent) = 9 ชนะ s1 (6 + 0.5 recencyBoost)
    expect(ids(out)).toEqual(["o1", "s1"]);
  });

  it("boostArtists (§6 adaptive) ชนะคะแนนเท่ากัน", async () => {
    const out = await createRuleBasedProvider(
      fakeQueries({
        findSeedTracks: vi.fn(async () => [track("seed", { genres: ["Rock"] })]),
        findSameGenreTracks: vi.fn(async () => [
          track("u1", { artist: "a1", genres: ["Rock"] }),
          track("v1", { artist: "a2", genres: ["Rock"] }),
        ]),
      }),
      { rng: rng0 },
    ).getRadioTracks({ trackId: "seed", boostArtists: ["A2"] }, new Set(), 2);
    expect(ids(out)).toEqual(["v1", "u1"]);
  });

  it("pool ว่างหลังกัน recent/skipped → คลายเป็นชั้นที่ 2 (recent/skipped ออกก่อน genre)", async () => {
    const q = fakeQueries({
      findSeedTracks: vi.fn(async () => [track("seed", { genres: ["Rock"] })]),
      findSkippedTrackIds: vi.fn(async () => ["sk1"]),
      findRecentlyPlayedTrackIds: vi.fn(async () => ["rec1"]),
      // pass 1 (exclude มี sk1/rec1) → ว่าง; pass 2 (ไม่มี filter) → ได้ g1
      findSameGenreTracks: vi.fn(async (_g: string[], exclude: string[]) =>
        exclude.includes("rec1") || exclude.includes("sk1")
          ? []
          : [track("g1", { genres: ["Rock"] })],
      ),
    });
    const out = await createRuleBasedProvider(q, { rng: rng0 }).getRadioTracks(
      { trackId: "seed", userId: "u1" },
      new Set(),
      2,
    );
    expect(ids(out)).toEqual(["g1"]);
  });

  it("มีผลบางส่วนแล้วห้ามคลาย genre (radio ต้องแนวเดียวกันทั้งหมด)", async () => {
    const q = fakeQueries({
      findSeedTracks: vi.fn(async () => [track("seed", { genres: ["Rock"] })]),
      findSameGenreTracks: vi.fn(async () => [track("in", { genres: ["Rock"] })]),
      findSameArtistTracks: vi.fn(async () => [track("same", { genres: ["Pop"] })]),
    });
    const out = await createRuleBasedProvider(q, { rng: rng0 }).getRadioTracks(
      { trackId: "seed", userId: "u1" },
      new Set(),
      5,
    );
    // ได้ 1 จาก genre pool — ตัวต่างแนวห้ามแอบโผล่มาเติม
    expect(ids(out)).toEqual(["in"]);
  });

  it("genre constraint คลายเป็นชั้นสุดท้ายเมื่อ pool ยังว่าง (§9)", async () => {
    const logs: string[] = [];
    const q = fakeQueries({
      findSeedTracks: vi.fn(async () => [track("seed", { genres: ["Rock"] })]),
      findSameGenreTracks: vi.fn(async () => [] as RadioCandidate[]),
      findSameArtistTracks: vi.fn(async () => [track("sa", { genres: ["Pop"] })]),
      findSimilarTitleTracks: vi.fn(async () => [] as RadioCandidate[]),
    });
    const out = await createRuleBasedProvider(q, {
      rng: rng0,
      log: (m) => logs.push(m),
    }).getRadioTracks({ trackId: "seed", userId: "u1" }, new Set(), 2);
    expect(ids(out)).toEqual(["sa"]);
    expect(logs.join(" ")).toContain("คลาย genre constraint");
  });

  it("same genre/played/liked ว่างหมด → similar-title fallback ยังทำงาน", async () => {
    const q = fakeQueries({
      findSeedTracks: vi.fn(async () => [track("seed", { genres: ["Rock"] })]),
      findSimilarTitleTracks: vi.fn(async () => [track("sim", { genres: ["Rock"] })]),
    });
    const out = await createRuleBasedProvider(q, { rng: rng0 }).getRadioTracks(
      { trackId: "seed" },
      new Set(),
      2,
    );
    expect(ids(out)).toEqual(["sim"]);
  });
});

describe("getHomeFeed", () => {
  it("user ไม่มี like/history → [] (cold start §7)", async () => {
    const out = await createRuleBasedProvider(fakeQueries(), { rng: rng0 }).getHomeFeed(
      "u1",
      10,
    );
    expect(out).toEqual([]);
  });

  it("liked/top played bypass genre, candidate ต่างแนวถูกตัด, recent filter ถูก exclude", async () => {
    const q = fakeQueries({
      findLikedTracks: vi.fn(async () => [
        track("l1", { genres: ["Rock"], artist: "al" }),
      ]),
      findTopPlayedTracks: vi.fn(async () => [track("t1", { artist: "at" })]), // ไม่มี genre
      findRecentlyPlayedTrackIds: vi.fn(async () => ["rec1"]),
      findSameGenreTracks: vi.fn(async (genres: string[], exclude: string[]) => {
        expect(genres).toEqual(["rock"]);
        expect(exclude).toContain("rec1");
        return [
          track("g1", { genres: ["Pop"] }), // ต่างแนว → ตัด
          track("g2", { genres: ["Rock"], artist: "al" }), // แนวตรง + artist ของ liked
        ];
      }),
      findSameArtistTracks: vi.fn(async () => [track("sa")]), // ไม่มี genre → ตัด
      findRecentlyPlayedTracks: vi.fn(async () => [track("r1")]), // ไม่มี genre → ตัด
    });
    const out = await createRuleBasedProvider(q, { rng: rng0 }).getHomeFeed("u1", 5);
    // l1: genre+liked+same-artist = 15.5 · g2: genre+same-artist = 10.5 · t1: top+same-artist = 8.5
    expect(ids(out)).toEqual(["l1", "g2", "t1"]);
  });

  it("seedGenres cap 5 แนวที่ถี่สุด", async () => {
    let gotGenres: string[] | null = null;
    const liked = [
      track("l1", { genres: ["Rock"] }),
      track("l2", { genres: ["Rock"] }),
      track("l3", { genres: ["Pop"] }),
      track("l4", { genres: ["Jazz"] }),
      track("l5", { genres: ["Metal"] }),
      track("l6", { genres: ["Folk"] }),
      track("l7", { genres: ["Blues"] }),
    ];
    await createRuleBasedProvider(
      fakeQueries({
        findLikedTracks: vi.fn(async () => liked),
        findSameGenreTracks: vi.fn(async (genres: string[]) => {
          gotGenres = genres;
          return [] as RadioCandidate[];
        }),
      }),
      { rng: rng0 },
    ).getHomeFeed("u1", 5);
    expect(gotGenres).toEqual(["rock", "pop", "jazz", "metal", "folk"]);
  });

  it("limit ≤ 0 → []", async () => {
    const out = await createRuleBasedProvider(
      fakeQueries({
        findLikedTracks: vi.fn(async () => [track("l1")]),
      }),
      { rng: rng0 },
    ).getHomeFeed("u1", 0);
    expect(out).toEqual([]);
  });
});
