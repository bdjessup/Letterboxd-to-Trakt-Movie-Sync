import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBatch, resolveFilm } from "./resolve";
import type { TraktApp } from "./trakt";

const app: TraktApp = { clientId: "c", apiUrl: "https://api.trakt.tv" };
const fetchMock = vi.fn<typeof fetch>();

type Hit = [number, string, number];

/** Answer searches from a tiny catalog, honouring the `years` filter. */
function serveCatalog(catalog: Hit[]) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const query = url.searchParams.get("query")?.toLowerCase() ?? "";
    const years = url.searchParams.get("years");
    const hits = catalog
      .filter(
        ([, title, year]) =>
          title.toLowerCase().includes(query) && (!years || String(year) === years),
      )
      .map(([trakt, title, year]) => ({
        movie: { title, year, ids: { trakt, slug: `s${trakt}` } },
      }));
    return Response.json(hits);
  });
}

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("resolveFilm", () => {
  const catalog: Hit[] = [
    [1, "Dune", 2021],
    [2, "Dune", 1984],
    [3, "Parasite", 2019],
  ];

  it("stops after one search when the year matches exactly", async () => {
    serveCatalog(catalog);
    const out = await resolveFilm(app, "tok", { title: "Dune", year: 1984 });
    expect(out).toMatchObject({
      calls: 1,
      resolution: { status: "matched", confidence: "exact", movie: { trakt: 2 } },
    });
  });

  it("falls back to a search without the year for off-by-one releases", async () => {
    serveCatalog(catalog);
    const out = await resolveFilm(app, "tok", { title: "Parasite", year: 2020 });
    expect(out).toMatchObject({
      calls: 2,
      resolution: { status: "matched", confidence: "likely", movie: { trakt: 3 } },
    });
  });

  it("reports films Trakt doesn't have", async () => {
    serveCatalog(catalog);
    const out = await resolveFilm(app, "tok", { title: "Unknown", year: 2001 });
    expect(out).toEqual({ calls: 2, resolution: { status: "not_found" } });
  });

  it("doesn't repeat the search when there's no year", async () => {
    serveCatalog(catalog);
    const out = await resolveFilm(app, "tok", { title: "Unknown", year: null });
    expect(out.calls).toBe(1);
  });
});

describe("resolveBatch", () => {
  const films = Array.from({ length: 8 }, (_, i) => ({ title: `Film ${i}`, year: 2000 }));
  const hit = (index: number) =>
    Response.json([{ movie: { title: `Film ${index}`, year: 2000, ids: { trakt: index + 1 } } }]);

  function pendingResponse() {
    let finish: (response: Response) => void = () => {};
    const response = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    return { response, finish };
  }

  it("keeps input order when searches finish out of order and caps parallelism", async () => {
    const initial = Array.from({ length: 4 }, pendingResponse);
    let active = 0;
    let peak = 0;
    fetchMock.mockImplementation(async (input) => {
      const index = Number(new URL(String(input)).searchParams.get("query")?.split(" ")[1]);
      active++;
      peak = Math.max(peak, active);
      const result = await (initial[index]?.response ?? hit(index));
      active--;
      return result;
    });
    const pending = resolveBatch(app, "tok", films);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    initial[3]?.finish(hit(3));
    initial[2]?.finish(hit(2));
    initial[1]?.finish(hit(1));
    initial[0]?.finish(hit(0));
    const result = await pending;
    expect(result.status).toBe("complete");
    expect(result.resolutions.map((r) => (r?.status === "matched" ? r.movie.trakt : null))).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    expect(result.calls).toBe(8);
    expect(result.cacheHits).toBe(0);
    expect(peak).toBe(4);
  });

  it("counts edge-cache hits without making another Trakt request", async () => {
    vi.stubGlobal("caches", {
      default: {
        match: async (key: string) =>
          key.endsWith(encodeURIComponent("film 0|2000"))
            ? Response.json({ trakt: 1, slug: "one", title: "Film 0", year: 2000 })
            : undefined,
        put: vi.fn(),
      },
    });
    fetchMock.mockResolvedValue(hit(1));
    const result = await resolveBatch(app, "tok", films.slice(0, 2));
    expect(result).toMatchObject({ status: "complete", calls: 1, cacheHits: 1 });
    expect(result.resolutions.map((r) => (r?.status === "matched" ? r.movie.trakt : null))).toEqual(
      [1, 2],
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves completed films, drains in-flight searches, and stops scheduling after a 429", async () => {
    const first = pendingResponse();
    const third = pendingResponse();
    let settled = false;
    fetchMock.mockImplementation(async (input) => {
      const query = new URL(String(input)).searchParams.get("query");
      if (query === "Film 0") return first.response;
      if (query === "Film 1")
        return new Response(null, { status: 429, headers: { "Retry-After": "30" } });
      if (query === "Film 2") return third.response;
      return hit(3);
    });
    const pending = resolveBatch(app, "tok", films).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(settled).toBe(false);
    third.finish(hit(2));
    expect(settled).toBe(false);
    first.finish(hit(0));
    const result = await pending;
    expect(result).toMatchObject({
      status: "partial",
      calls: 3,
      cacheHits: 0,
      error: { code: "rate_limited", retryAfter: 30 },
    });
    expect(result.resolutions.map((r) => (r?.status === "matched" ? r.movie.trakt : null))).toEqual(
      [1, null, 3, 4, null, null, null, null],
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps the longest retry delay reported by in-flight requests", async () => {
    const delayed = pendingResponse();
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "30" } }))
      .mockReturnValueOnce(delayed.response);
    const pending = resolveBatch(app, "tok", films.slice(0, 2));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    delayed.finish(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    expect(await pending).toMatchObject({
      status: "partial",
      resolutions: [null, null],
      error: { code: "rate_limited", retryAfter: 60 },
    });
  });

  it("surfaces an authentication failure even after another request was rate limited", async () => {
    const delayed = pendingResponse();
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "30" } }))
      .mockReturnValueOnce(delayed.response);
    const pending = resolveBatch(app, "tok", films.slice(0, 2));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    delayed.finish(new Response(null, { status: 401 }));
    expect(await pending).toMatchObject({
      status: "partial",
      resolutions: [null, null],
      error: { code: "unauthorized" },
    });
  });

  it("drains outstanding work before throwing an unexpected failure", async () => {
    const delayed = pendingResponse();
    let settled = false;
    fetchMock
      .mockReturnValueOnce(delayed.response)
      .mockResolvedValueOnce(new Response("invalid json"));
    const guarded = resolveBatch(app, "tok", films.slice(0, 2)).catch((error: unknown) => {
      settled = true;
      return error;
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    delayed.finish(hit(0));
    expect(await guarded).toBeInstanceOf(SyntaxError);
  });

  it("returns an empty complete batch without calling Trakt", async () => {
    expect(await resolveBatch(app, "tok", [])).toEqual({
      status: "complete",
      resolutions: [],
      calls: 0,
      cacheHits: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
