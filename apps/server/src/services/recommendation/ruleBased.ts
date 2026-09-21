/**
 * RuleBasedProvider — recommendation.md §2 (Phase 12)
 * candidate pool (genre/artist/album/liked/top played/recently played + similar-title
 * สุดท้าย) → genre constraint §2.1.1 เป็น hard filter → scoring §2.2 → weighted
 * random selection; คลาย filter ทีละชั้นเมื่อ pool ว่าง (§9: recently played ออกก่อน,
 * genre ออกท้ายสุด)
 * artist จาก YouTube คือชื่อผู้อัปโหลด เวอร์ชันเพลงเดียวกันจึงหาได้จากชื่อเพลงเป็น fallback
 */
import type { Db } from "../../db/client.js";
import {
  findLastCompletedTracks,
  findLikedTracksForRadio,
  findRecentlyPlayedTrackIds,
  findRecentlyPlayedTracks,
  findSameAlbumTracks,
  findSameArtistTracks,
  findSameGenreTracks,
  findSimilarTitleTracks,
  findSkippedTrackIds,
  findTopPlayedTracks,
} from "../../repositories/recommendation.repo.js";
import { findTrackCandidates } from "../../repositories/tracks.repo.js";
import type { RadioCandidate, RecommendationProvider } from "./provider.js";

/** §3 filter: recently played ล่าสุด (radio 50 / home 20) + skipped 20 */
const RECENT_FILTER_RADIO = 50;
const RECENT_FILTER_HOME = 20;
const SKIPPED_FILTER = 20;
/** §2.1.1 fallback — genres จากเพลงเล่นจบล่าสุด 10 เพลง */
const TASTE_TRACKS = 10;
/** recent candidate window: history 7 วันล่าสุด */
const RECENT_CANDIDATE_DAYS = 7;
/** §2.2 — สุ่มเลือกจาก top candidates (weighted) ไม่ใช่ top-N ตรง */
const WEIGHTED_TOP = 10;
/** home feed seedGenres: union genres จาก liked + top played ≤ 5 แนว */
const HOME_SEED_GENRE_CAP = 5;

/** DI เพื่อ unit test — ใน app ผูก repo จริง */
export interface ProviderQueries {
  findSeedTracks(ids: string[]): Promise<RadioCandidate[]>;
  findSameGenreTracks(
    genres: string[],
    exclude: string[],
    limit: number,
  ): Promise<RadioCandidate[]>;
  findSameArtistTracks(
    artists: string[],
    exclude: string[],
    limit: number,
  ): Promise<RadioCandidate[]>;
  findSameAlbumTracks(
    albums: string[],
    exclude: string[],
    limit: number,
  ): Promise<RadioCandidate[]>;
  findTopPlayedTracks(
    userId: string,
    exclude: string[],
    limit: number,
  ): Promise<RadioCandidate[]>;
  findLikedTracks(
    userId: string,
    exclude: string[],
    limit: number,
  ): Promise<RadioCandidate[]>;
  findRecentlyPlayedTracks(
    userId: string,
    since: Date,
    exclude: string[],
    limit: number,
  ): Promise<RadioCandidate[]>;
  findRecentlyPlayedTrackIds(userId: string, limit: number): Promise<string[]>;
  findSkippedTrackIds(userId: string, limit: number): Promise<string[]>;
  findLastCompletedTracks(userId: string, limit: number): Promise<RadioCandidate[]>;
  findSimilarTitleTracks(
    titleTokens: string[],
    exclude: string[],
    limit: number,
  ): Promise<RadioCandidate[]>;
}

export function realProviderQueries(db: Db): ProviderQueries {
  return {
    findSeedTracks: (ids) => findTrackCandidates(db, ids),
    findSameGenreTracks: (genres, exclude, limit) =>
      findSameGenreTracks(db, genres, exclude, limit),
    findSameArtistTracks: (artists, exclude, limit) =>
      findSameArtistTracks(db, artists, exclude, limit),
    findSameAlbumTracks: (albums, exclude, limit) =>
      findSameAlbumTracks(db, albums, exclude, limit),
    findTopPlayedTracks: (userId, exclude, limit) =>
      findTopPlayedTracks(db, userId, exclude, limit),
    findLikedTracks: (userId, exclude, limit) =>
      findLikedTracksForRadio(db, userId, exclude, limit),
    findRecentlyPlayedTracks: (userId, since, exclude, limit) =>
      findRecentlyPlayedTracks(db, userId, since, exclude, limit),
    findRecentlyPlayedTrackIds: (userId, limit) =>
      findRecentlyPlayedTrackIds(db, userId, limit),
    findSkippedTrackIds: (userId, limit) => findSkippedTrackIds(db, userId, limit),
    findLastCompletedTracks: (userId, limit) =>
      findLastCompletedTracks(db, userId, limit),
    findSimilarTitleTracks: (tokens, exclude, limit) =>
      findSimilarTitleTracks(db, tokens, exclude, limit),
  };
}

/** §2.1.1 — lowercase + ตัดขีด/ช่องว่าง ("Hip-Hop" = "hip hop"); ต้องตรงกับ NORM_GENRE_SQL */
export function normalizeGenre(genre: string): string {
  return genre.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeGenres(genres: string[] | null | undefined): Set<string> {
  return new Set((genres ?? []).map(normalizeGenre).filter(Boolean));
}

/** token ยาว ≥ 4 ตัวอักษรจากชื่อเพลง (ตัด short/stopword-ish อย่าง "hq", "one") */
export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4)
    .slice(0, 6);
}

const normArtist = (artist: string): string => artist.trim().toLowerCase();

/** candidate.genres ∩ seedGenres ≠ ∅ (normalized แล้วทั้งคู่) */
function genresIntersect(c: RadioCandidate, seedGenres: Set<string>): boolean {
  for (const g of normalizeGenres(c.genres)) {
    if (seedGenres.has(g)) return true;
  }
  return false;
}

export interface ProviderOptions {
  rng?: () => number;
  /** log warn (fallback/constraint relax) — เดิม error ถูกกลืนทำ debug ยาก (บทเรียน Phase 11) */
  log?: (message: string) => void;
  now?: () => Date;
}

/** คะแนนฐานตาม §2.1 + recency/artist-repeat/boost/jitter ตาม §2.2 */
function makeScorer(ctx: {
  seedArtists: Set<string>;
  seedAlbums: Set<string>;
  seedGenres: Set<string>;
  likedIds: Set<string>;
  topPlayedIds: Set<string>;
  recentIds: Set<string>;
  boostArtists: Set<string>;
  rng: () => number;
}) {
  return (c: RadioCandidate, artistCounts: Map<string, number>): number => {
    let score = 0;
    if (genresIntersect(c, ctx.seedGenres)) score += 6;
    if (ctx.likedIds.has(c.id)) score += 5;
    if (ctx.topPlayedIds.has(c.id)) score += 4;
    if (ctx.seedArtists.has(normArtist(c.artist))) score += 4;
    if (c.album && ctx.seedAlbums.has(c.album.trim().toLowerCase())) score += 3;
    if (ctx.recentIds.has(c.id)) score += 3;
    // recencyBoost — เพลงที่ user ไม่เคย/นานไม่ได้ยิน (ไม่อยู่ในหน้าต่าง recent) ได้ boost
    score += 0.5 * (ctx.recentIds.has(c.id) ? 0 : 1);
    // artist ซ้ำในผลลัพธ์เกิน 2 ตัว → −4 (กัน wall of same artist)
    if ((artistCounts.get(normArtist(c.artist)) ?? 0) >= 2) score -= 4;
    // §6 adaptive — ศิลปินที่เพลงเล่นจบใน radio นี้
    if (ctx.boostArtists.has(normArtist(c.artist))) score += 2;
    return score + (ctx.rng() * 2 - 1); // jitter ±1
  };
}

/** weighted random จาก top candidates — คะแนนติดลบยังมีสิทธิ์แต่น้ำหนักน้อยสุด */
function weightedPick<T extends { score: number }>(items: T[], rng: () => number): T {
  const weights = items.map((i) => Math.max(i.score, 0.1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/**
 * เลือกจาก pool จนครบ limit: ทุกรอบให้คะแนนใหม่ (artist penalty ขึ้นกับสิ่งที่เลือกไป
 * แล้ว) แล้ว weighted-pick จาก top 10 — คืนผลพร้อม update taken
 */
function selectRanked(
  pool: RadioCandidate[],
  score: (c: RadioCandidate, artistCounts: Map<string, number>) => number,
  limit: number,
  taken: Set<string>,
  rng: () => number,
): RadioCandidate[] {
  const picked: RadioCandidate[] = [];
  const artistCounts = new Map<string, number>();
  while (picked.length < limit) {
    const available = pool.filter((c) => !taken.has(c.id));
    if (available.length === 0) break;
    const scored = available
      .map((c) => ({ c, score: score(c, artistCounts) }))
      .sort((a, b) => b.score - a.score);
    const pick = weightedPick(scored.slice(0, WEIGHTED_TOP), rng);
    picked.push(pick.c);
    taken.add(pick.c.id);
    const a = normArtist(pick.c.artist);
    artistCounts.set(a, (artistCounts.get(a) ?? 0) + 1);
  }
  return picked;
}

function dedupeById(tracks: RadioCandidate[]): RadioCandidate[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

export function createRuleBasedProvider(
  queries: ProviderQueries,
  opts: ProviderOptions = {},
): RecommendationProvider {
  const rng = opts.rng ?? Math.random;
  const now = opts.now ?? (() => new Date());
  const log = opts.log;

  return {
    async getRadioTracks(seed, exclude, limit) {
      if (!seed.trackId || limit <= 0) return [];
      const [seedTrack] = await queries.findSeedTracks([seed.trackId]);
      if (!seedTrack) return [];

      // §2.1.1 seedGenres: genres ของ seed → fallback จากเพลงเล่นจบล่าสุด → คลาย constraint
      let seedGenres = normalizeGenres(seedTrack.genres);
      if (seedGenres.size === 0 && seed.userId) {
        const taste = dedupeById(
          await queries.findLastCompletedTracks(seed.userId, TASTE_TRACKS),
        ).flatMap((t) => [...normalizeGenres(t.genres)]);
        seedGenres = new Set(taste);
      }
      const constraint = seedGenres.size > 0 ? seedGenres : null;
      if (!constraint) {
        log?.(
          `recommendation: seed ${seedTrack.id} ไม่มี genre และไม่มี taste → คลาย genre constraint (same artist/album)`,
        );
      }

      const taken = new Set(exclude);
      taken.add(seedTrack.id);
      const boostArtists = new Set((seed.boostArtists ?? []).map(normArtist));
      const seedArtists = new Set([normArtist(seedTrack.artist)]);
      const seedAlbums = new Set(
        seedTrack.album ? [seedTrack.album.trim().toLowerCase()] : [],
      );

      const skipped = seed.userId
        ? await queries.findSkippedTrackIds(seed.userId, SKIPPED_FILTER)
        : [];
      const recentFilter = seed.userId
        ? await queries.findRecentlyPlayedTrackIds(seed.userId, RECENT_FILTER_RADIO)
        : [];

      /** รวม candidate จากทุกแหล่ง → filter ตาม pass (genre on/off) → scoring */
      const runPass = async (
        filterIds: string[],
        applyGenre: boolean,
      ): Promise<RadioCandidate[]> => {
        const baseExclude = [...taken, ...filterIds];
        const since = new Date(now().getTime() - RECENT_CANDIDATE_DAYS * 86_400_000);
        const [byGenre, byArtist, byAlbum, top, liked, recent] = await Promise.all([
          applyGenre && constraint
            ? queries.findSameGenreTracks([...constraint], baseExclude, limit)
            : Promise.resolve([] as RadioCandidate[]),
          queries.findSameArtistTracks([seedTrack.artist], baseExclude, limit),
          seedTrack.album
            ? queries.findSameAlbumTracks([seedTrack.album], baseExclude, limit)
            : Promise.resolve([] as RadioCandidate[]),
          seed.userId
            ? queries.findTopPlayedTracks(seed.userId, baseExclude, limit)
            : Promise.resolve([] as RadioCandidate[]),
          seed.userId
            ? queries.findLikedTracks(seed.userId, baseExclude, limit)
            : Promise.resolve([] as RadioCandidate[]),
          seed.userId
            ? queries.findRecentlyPlayedTracks(seed.userId, since, baseExclude, limit)
            : Promise.resolve([] as RadioCandidate[]),
        ]);

        let pool = dedupeById([
          ...byGenre,
          ...byArtist,
          ...byAlbum,
          ...top,
          ...liked,
          ...recent,
        ]);
        pool = pool.filter((c) => !taken.has(c.id) && !filterIds.includes(c.id));
        if (applyGenre && constraint) {
          pool = pool.filter((c) => genresIntersect(c, constraint));
        }

        // signal sets สำหรับ scoring — จากแหล่งที่ candidate มา (ก่อน genre filter)
        const likedIds = new Set(liked.map((t) => t.id));
        const topPlayedIds = new Set(top.map((t) => t.id));
        const recentIds = new Set(recent.map((t) => t.id));
        const score = makeScorer({
          seedArtists,
          seedAlbums,
          seedGenres: constraint ?? new Set(),
          likedIds,
          topPlayedIds,
          recentIds,
          boostArtists,
          rng,
        });

        let picked = selectRanked(pool, score, limit, taken, rng);
        // §7 fallback — ยังขาด → เพลงชื่อคล้ายกัน (อยู่ใต้ genre constraint เดิมด้วย)
        if (picked.length < limit) {
          const excluded = [...taken, ...filterIds];
          const similar = await queries.findSimilarTitleTracks(
            titleTokens(seedTrack.title),
            excluded,
            limit,
          );
          const fresh = similar.filter(
            (c) =>
              !taken.has(c.id) &&
              !picked.some((p) => p.id === c.id) &&
              (!applyGenre || !constraint || genresIntersect(c, constraint)),
          );
          picked = [
            ...picked,
            ...selectRanked(fresh, score, limit - picked.length, taken, rng),
          ];
        }
        return picked;
      };

      // §9 คลาย filter ทีละชั้น: (1) กัน recent+skipped → (2) ปล่อย recent/skipped (ยังกัน genre)
      // → (3) คลาย genre เฉพาะ "ผลว่างเปล่า" — ถ้ามีผลบางส่วนแล้วห้ามคลาย เพราะ radio
      // รับประกันว่าทุกเพลงอยู่แนวเดียวกับ seed (DoD)
      const picked = [
        ...(await runPass([...skipped, ...recentFilter], true)),
        ...(await runPass([], true)),
      ];
      if (picked.length === 0) {
        log?.(
          `recommendation: pool ว่างหลัง genre constraint (seed ${seedTrack.id}) → คลาย genre constraint เป็นชั้นสุดท้าย`,
        );
        picked.push(...(await runPass([], false)));
      }
      return picked.slice(0, limit);
    },

    async getHomeFeed(userId, limit) {
      if (limit <= 0 || !userId) return [];
      const recentFilter = await queries.findRecentlyPlayedTrackIds(
        userId,
        RECENT_FILTER_HOME,
      );
      // §2 "Home feed ใช้ liked + frequently played เป็น seed หลัก" — seeds ของ user เอง
      // ไม่โดน recent filter (ไม่งั้น user ที่มี history สั้น ๆ จะเหลือ seed ว่างทั้งที่
      // เพิ่งเล่นทุกเพลงที่มี); filter ใช้กับ candidate ใหม่ (genre/artist/recent) เท่านั้น
      const [liked, top] = await Promise.all([
        queries.findLikedTracks(userId, [], limit),
        queries.findTopPlayedTracks(userId, [], limit),
      ]);
      if (liked.length === 0 && top.length === 0) return []; // cold start §7

      // seedGenres = union genres ของ liked + top played ≤ 5 แนวที่ถี่สุด
      const genreCounts = new Map<string, number>();
      for (const t of [...liked, ...top]) {
        for (const g of normalizeGenres(t.genres)) {
          genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
        }
      }
      const seedGenres = new Set(
        [...genreCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, HOME_SEED_GENRE_CAP)
          .map(([g]) => g),
      );

      const since = new Date(now().getTime() - RECENT_CANDIDATE_DAYS * 86_400_000);
      const seedArtists = new Set([...liked, ...top].map((t) => normArtist(t.artist)));
      const exclude = [...recentFilter];
      const [byGenre, byArtist, recent] = await Promise.all([
        seedGenres.size > 0
          ? queries.findSameGenreTracks([...seedGenres], exclude, limit)
          : Promise.resolve([] as RadioCandidate[]),
        queries.findSameArtistTracks([...seedArtists], exclude, limit),
        queries.findRecentlyPlayedTracks(userId, since, exclude, limit),
      ]);

      const taken = new Set<string>();
      const likedIds = new Set(liked.map((t) => t.id));
      const topIds = new Set(top.map((t) => t.id));
      const pool = dedupeById([
        ...liked,
        ...top,
        ...byGenre,
        ...byArtist,
        ...recent,
      ]).filter(
        (c) =>
          !taken.has(c.id) &&
          // §7 #3: liked/top played ของ user เองไม่ต้องผ่าน genre constraint
          (likedIds.has(c.id) ||
            topIds.has(c.id) ||
            seedGenres.size === 0 ||
            genresIntersect(c, seedGenres)),
      );
      const score = makeScorer({
        seedArtists,
        seedAlbums: new Set(),
        seedGenres,
        likedIds,
        topPlayedIds: topIds,
        recentIds: new Set(recent.map((t) => t.id)),
        boostArtists: new Set(),
        rng,
      });
      return selectRanked(pool, score, limit, taken, rng);
    },
  };
}
