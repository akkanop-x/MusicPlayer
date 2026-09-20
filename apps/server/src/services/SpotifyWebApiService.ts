/**
 * Spotify Web API — genre enrichment (roadmap Phase 3, database.md §2.2 + ข้อตัดสินใจ #4)
 * client credentials grant (ไม่มี user OAuth ใน MVP); ไม่มี credentials → fail-soft (ยังใช้งานได้)
 * genre = artist genres เก็บ raw tags lowercase/trim — matching แบบ intersection ใน MVP
 */
export interface SpotifyWebApiOptions {
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export function createSpotifyWebApiService(options: SpotifyWebApiOptions = {}) {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  let cachedToken: CachedToken | null = null;
  const inFlightToken: { promise: Promise<string> | null } = { promise: null };

  const enabled = Boolean(options.clientId && options.clientSecret);

  async function getToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000)
      return cachedToken.token;
    if (inFlightToken.promise) return inFlightToken.promise;

    const promise = (async () => {
      const basic = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString(
        "base64",
      );
      const response = await fetchImpl("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Spotify token request failed: ${response.status}`);
      }
      const payload = (await response.json()) as {
        access_token: string;
        expires_in: number;
      };
      cachedToken = {
        token: payload.access_token,
        expiresAt: Date.now() + payload.expires_in * 1000,
      };
      return cachedToken.token;
    })();

    inFlightToken.promise = promise;
    try {
      return await promise;
    } finally {
      inFlightToken.promise = null;
    }
  }

  /**
   * คืน artist genres ของชื่อศิลปิน (raw tags lowercase/trim)
   * fail-soft: ไม่มี credentials / error ใด ๆ → [] และผู้เรียกไม่ควรพัง
   */
  async function artistGenres(artist: string): Promise<string[]> {
    if (!enabled) return [];
    try {
      const token = await getToken();
      const searchResponse = await fetchImpl(
        `https://api.spotify.com/v1/search?type=artist&limit=1&q=${encodeURIComponent(artist)}`,
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!searchResponse.ok) return [];
      const payload = (await searchResponse.json()) as {
        artists?: { items?: Array<{ genres?: string[] }> };
      };
      const genres = payload.artists?.items?.[0]?.genres ?? [];
      return genres.map((g) => g.trim().toLowerCase()).filter((g) => g.length > 0);
    } catch {
      return [];
    }
  }

  return { artistGenres, enabled };
}
