import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthorizationRequest,
  exchangeCode,
  fetchLibraryPage,
  fetchViewer,
  type OAuthClient,
  pushToTrakt,
  refreshAccessToken,
  revokeToken,
  searchMovies,
  type TraktApp,
  TraktError,
  traktRequest,
} from "./trakt";

const app: TraktApp = { clientId: "client-123", apiUrl: "https://api.trakt.tv" };
const fetchMock = vi.fn<typeof fetch>();

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

/** Run a request while letting retry back-off timers elapse. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const guarded = promise.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  await vi.runAllTimersAsync();
  const r = await guarded;
  if (r.ok) return r.v;
  throw r.e;
}

describe("traktRequest", () => {
  it("paces and counts every actual GET attempt, including retries", async () => {
    const before = vi.fn().mockResolvedValue(667);
    const readMetrics = { upstreamReads: 0, retries: 0, pacingWaitMs: 0, rateLimits: 0 };
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(json([]));
    await settle(
      traktRequest(
        { ...app, readPacing: { before, pause: vi.fn() }, readMetrics },
        "/search/movie",
      ),
    );
    expect(before).toHaveBeenCalledTimes(2);
    expect(readMetrics).toEqual({
      upstreamReads: 2,
      retries: 1,
      pacingWaitMs: 1334,
      rateLimits: 0,
    });
  });

  it("publishes a shared cooldown and returns 429 without replaying a paced read", async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    const before = vi.fn().mockResolvedValue(0);
    fetchMock.mockResolvedValue(
      new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
    );
    await expect(
      traktRequest({ ...app, readPacing: { before, pause } }, "/search/movie"),
    ).rejects.toMatchObject({ code: "rate_limited", retryAfter: 60 });
    expect(pause).toHaveBeenCalledWith(60);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not consume the GET budget for writes", async () => {
    const before = vi.fn();
    fetchMock.mockResolvedValue(json({}));
    await traktRequest({ ...app, readPacing: { before, pause: vi.fn() } }, "/sync/ratings", {
      method: "POST",
      body: {},
    });
    expect(before).not.toHaveBeenCalled();
  });

  it("sends Trakt's required headers", async () => {
    fetchMock.mockResolvedValue(json([]));
    await traktRequest(app, "/search/movie", {
      token: "tok",
      query: { query: "Heat", years: 1995 },
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.trakt.tv/search/movie?query=Heat&years=1995");
    const headers = new Headers(init?.headers);
    expect(headers.get("trakt-api-version")).toBe("2");
    expect(headers.get("trakt-api-key")).toBe("client-123");
    expect(headers.get("authorization")).toBe("Bearer tok");
    expect(headers.get("user-agent")).toMatch(/letterboxd-to-trakt/);
  });

  it.each(["@evil.example/x", "//evil.example/x", "https://evil.example/x", "relative"])(
    "refuses to leave the Trakt origin (%s)",
    async (path) => {
      await expect(traktRequest(app, path)).rejects.toThrow(/non-Trakt/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("waits out a short Retry-After and retries", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(json({ ok: true }));
    const { data } = await settle(traktRequest(app, "/sync/history", { method: "POST", body: {} }));
    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hands long rate limits back to the caller", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
    );
    await expect(settle(traktRequest(app, "/search/movie"))).rejects.toMatchObject({
      code: "rate_limited",
      retryAfter: 60,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries reads on server errors", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(json([1]));
    const { data } = await settle(traktRequest(app, "/sync/ratings/movies"));
    expect(data).toEqual([1]);
  });

  it("never retries a write after a server error (it may have been applied)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));
    await expect(
      settle(traktRequest(app, "/sync/history", { method: "POST", body: {} })),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries a write after a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      settle(traktRequest(app, "/sync/history", { method: "POST", body: {} })),
    ).rejects.toMatchObject({ code: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "unauthorized"],
    [403, "bad_request"],
    [420, "account_limit"],
    [423, "unauthorized"],
    [404, "bad_request"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    const err = await settle(traktRequest(app, "/users/settings")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TraktError);
    expect(err).toMatchObject({ status, code });
  });
});

describe("endpoints", () => {
  it("searches by year and drops malformed results", async () => {
    fetchMock.mockResolvedValue(
      json([
        {
          type: "movie",
          movie: { title: "Heat", year: 1995, ids: { trakt: 1, slug: "heat-1995" } },
        },
        { type: "movie", movie: { title: "Broken", ids: {} } },
      ]),
    );
    const results = await searchMovies(app, "tok", "Heat", 1995);
    expect(results).toEqual([
      { trakt: 1, slug: "heat-1995", title: "Heat", year: 1995, imdb: null, tmdb: null },
    ]);
  });

  it("reads library pages compactly with the page count", async () => {
    fetchMock.mockResolvedValue(
      json(
        [
          { watched_at: "2024-01-01T00:00:00.000Z", movie: { ids: { trakt: 7 } } },
          { watched_at: "2024-01-02T00:00:00.000Z", movie: {} },
        ],
        { headers: { "X-Pagination-Page-Count": "4" } },
      ),
    );
    await expect(fetchLibraryPage(app, "tok", "history", 2)).resolves.toEqual({
      kind: "history",
      page: 2,
      pageCount: 4,
      movies: [{ trakt: 7, slug: "7", title: "Untitled", year: null, imdb: null, tmdb: null }],
      items: [[7, "2024-01-01T00:00:00.000Z"]],
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/sync/history/movies?page=2&limit=250");
  });

  it("sends history, ratings and watchlist in Trakt's shape", async () => {
    fetchMock.mockResolvedValue(
      json({ added: { movies: 1 }, not_found: { movies: [{ ids: { trakt: 9 } }] } }),
    );
    const res = await pushToTrakt(app, "tok", {
      kind: "ratings",
      items: [
        { trakt: 1, rating: 8, ratedAt: "2024-01-01T12:00:00.000Z" },
        { trakt: 9, rating: 3 },
      ],
    });
    expect(res).toEqual({ added: 1, existing: 0, notFound: [9] });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.trakt.tv/sync/ratings");
    expect(JSON.parse(String(init?.body))).toEqual({
      movies: [
        { rating: 8, rated_at: "2024-01-01T12:00:00.000Z", ids: { trakt: 1 } },
        { rating: 3, ids: { trakt: 9 } },
      ],
    });
  });

  it("builds the viewer and ignores non-https avatars", async () => {
    fetchMock.mockResolvedValue(
      json({
        user: {
          username: "sam",
          name: "",
          vip: true,
          images: { avatar: { full: "http://x/a.png" } },
        },
        account: { timezone: "Europe/Paris" },
      }),
    );
    await expect(fetchViewer(app, "tok")).resolves.toEqual({
      username: "sam",
      slug: "sam",
      name: "sam",
      avatarUrl: null,
      timeZone: "Europe/Paris",
      vip: true,
    });
  });

  it("finishes connecting when the profile lookup asks for a longer pause", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "60" } }))
      .mockResolvedValueOnce(json({ user: { username: "sam" }, account: { timezone: "UTC" } }));
    await expect(settle(fetchViewer(app, "tok"))).resolves.toMatchObject({
      username: "sam",
      timeZone: "UTC",
    });
  });

  it("stops waiting when profile throttling exceeds the sign-in budget", async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
    );
    await expect(settle(fetchViewer(app, "tok"))).rejects.toMatchObject({
      code: "rate_limited",
      retryAfter: 60,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("OAuth with PKCE", () => {
  const client: OAuthClient = {
    app,
    authUrl: "https://auth.trakt.tv",
    clientSecret: "server-secret",
    redirectUri: "https://sync.example/api/auth/callback",
  };
  const tokens = {
    access_token: "access",
    refresh_token: "refresh",
    expires_in: 604800,
    created_at: 1793664000,
  };

  it("creates a fresh S256 authorization request with offline access", async () => {
    const first = await createAuthorizationRequest(client);
    const second = await createAuthorizationRequest(client);
    const url = new URL(first.authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://auth.trakt.tv/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client-123",
      redirect_uri: "https://sync.example/api/auth/callback",
      state: first.state,
      scope: "public offline_access",
      code_challenge: createHash("sha256").update(first.codeVerifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    expect(first.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.codeVerifier).not.toBe(first.codeVerifier);
    expect(second.state).not.toBe(first.state);
  });

  it("exchanges the code at the auth origin with its verifier and no client secret", async () => {
    fetchMock.mockResolvedValue(json(tokens));
    await expect(exchangeCode(client, "authorization-code", "one-time-verifier")).resolves.toEqual(
      tokens,
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://auth.trakt.tv/oauth/token");
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: "client-123",
      redirect_uri: "https://sync.example/api/auth/callback",
      code: "authorization-code",
      code_verifier: "one-time-verifier",
      grant_type: "authorization_code",
    });
  });

  it("refreshes a PKCE session without a client secret", async () => {
    fetchMock.mockResolvedValue(json(tokens));
    const { clientSecret: _unused, ...withoutSecret } = client;
    await refreshAccessToken(withoutSecret, "old-refresh");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://auth.trakt.tv/oauth/token");
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: "client-123",
      redirect_uri: "https://sync.example/api/auth/callback",
      refresh_token: "old-refresh",
      grant_type: "refresh_token",
    });
  });

  it("uses the mock auth origin for authorization, token exchange and revocation", async () => {
    const mockClient = { ...client, authUrl: "http://localhost:4010" };
    const authorization = await createAuthorizationRequest(mockClient);
    expect(new URL(authorization.authorizeUrl).origin).toBe("http://localhost:4010");
    fetchMock.mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json({}));
    await exchangeCode(mockClient, "code", authorization.codeVerifier);
    await revokeToken(mockClient, "access");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://localhost:4010/oauth/token",
      "http://localhost:4010/oauth/revoke",
    ]);
  });
});
