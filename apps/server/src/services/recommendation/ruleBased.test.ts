import { describe, expect, it } from "vitest";
import type { TrackDTO } from "@musicplayer/shared";
import { createRuleBasedProvider, type ProviderQueries } from "./ruleBased.js";

function track(id: string, artist = "Daft Punk"): TrackDTO {
  return {
    id,
    title: `T ${id}`,
    artist,
    album: null,
    durationMs: 200_000,
    isStream: false,
    isSeekable: true,
    artworkUrl: null,
    sourceName: "youtube",
    isLiked: false,
  };
}

function fakeQueries(over: Partial<ProviderQueries> = {}): ProviderQueries {
  return {
    findSeedTracks: async (ids) => (ids.includes("seed") ? [track("seed")] : []),
    findSameArtistTracks: async (_a, _e, limit) =>
      Array.from({ length: Math.max(limit, 0) }, (_, i) => track(`same-${i}`)),
    findTopPlayedTracks: async (_u, _e, limit) =>
      Array.from({ length: Math.max(limit, 0) }, (_, i) => track(`top-${i}`)),
    findLikedTracks: async (_u, _e, limit) =>
      Array.from({ length: Math.max(limit, 0) }, (_, i) => track(`liked-${i}`)),
    findSimilarTitleTracks: async (_t, _e, limit) =>
      Array.from({ length: Math.max(limit, 0) }, (_, i) => track(`sim-${i}`)),
    ...over,
  };
}

describe("RuleBasedProvider (Phase 11 minimal)", () => {
  it("ไม่มี seed / seed หายจากตาราง → empty", async () => {
    const provider = createRuleBasedProvider(fakeQueries());
    await expect(provider.getRadioTracks({}, new Set(), 10)).resolves.toEqual([]);
    await expect(
      provider.getRadioTracks({ trackId: "ghost" }, new Set(), 10),
    ).resolves.toEqual([]);
  });

  it("same artist ของ seed มาก่อน, exclude (รวม seed เอง) ถูกส่งให้ query และไม่ปรากฏในผล", async () => {
    const seen: Array<string[]> = [];
    const provider = createRuleBasedProvider(
      fakeQueries({
        findSameArtistTracks: async (_a, exclude, limit) => {
          seen.push(exclude);
          return [track("seed"), track("x"), track("same-0")].slice(0, limit);
        },
      }),
    );
    const out = await provider.getRadioTracks(
      { trackId: "seed", userId: "u1" },
      new Set(["gone"]),
      3,
    );
    expect(seen[0]).toContain("seed");
    expect(seen[0]).toContain("gone");
    // same artist ได้ 2 ยังไม่ครบ limit 3 → เติมจาก top played
    expect(out.map((t) => t.id)).toEqual(["x", "same-0", "top-0"]);
  });

  it("same artist ไม่พอ → เติม top played แล้ว liked, dedupe ข้าม source + จำกัด limit", async () => {
    const provider = createRuleBasedProvider(
      fakeQueries({
        findSameArtistTracks: async () => [track("a1")],
        findTopPlayedTracks: async () => [track("p1"), track("dup"), track("p2")],
        findLikedTracks: async () => [track("dup"), track("l1")],
      }),
    );
    const out = await provider.getRadioTracks(
      { trackId: "seed", userId: "u1" },
      new Set(),
      5,
    );
    // dup โผล่ทั้ง top played และ liked → เอ็นเฉพาะตัวแรก
    expect(out.map((t) => t.id)).toEqual(["a1", "p1", "dup", "p2", "l1"]);
  });

  it("ไม่มี userId (radio แบบ seed เดี่ยว) → ไม่ยิง query ส่วน user", async () => {
    let called = 0;
    const provider = createRuleBasedProvider(
      fakeQueries({
        findTopPlayedTracks: async () => {
          called += 1;
          return [];
        },
      }),
    );
    const out = await provider.getRadioTracks({ trackId: "seed" }, new Set(), 5);
    expect(called).toBe(0);
    expect(out.length).toBeGreaterThan(0);
  });

  it("same artist/played/liked ว่างหมด → fallback เพลงชื่อคล้ายกันจาก token ชื่อ seed", async () => {
    let gotTokens: string[] | null = null;
    const provider = createRuleBasedProvider(
      fakeQueries({
        findSameArtistTracks: async () => [],
        findTopPlayedTracks: async () => [],
        findLikedTracks: async () => [],
        findSimilarTitleTracks: async (tokens, exclude, limit) => {
          gotTokens = tokens;
          return [track("sim-1"), track("sim-2")].slice(0, limit);
        },
      }),
    );
    const out = await provider.getRadioTracks(
      { trackId: "seed", userId: "u1" },
      new Set(),
      2,
    );
    expect(out.map((t) => t.id)).toEqual(["sim-1", "sim-2"]);
    expect(gotTokens!.length).toBeGreaterThan(0);
  });
});
