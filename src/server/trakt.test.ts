import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchLibraryPage,
  fetchViewer,
  pushToTrakt,
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
});
