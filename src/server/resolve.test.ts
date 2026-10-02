import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapWithConcurrency, resolveFilm } from "./resolve";
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

describe("mapWithConcurrency", () => {
  it("keeps order and caps parallelism", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });
});
