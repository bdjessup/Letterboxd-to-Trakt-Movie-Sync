import { describe, expect, it } from "vitest";
import { filmKey } from "./matching";
import {
  buildPlan,
  buildRequests,
  DEFAULT_OPTIONS,
  type FilmPlan,
  filmsToResolve,
  type PlanOptions,
  reviewGroup,
  selectedByDefault,
} from "./plan";
import type { LetterboxdImport, Resolution, TraktLibrary } from "./types";

const TZ = "America/Los_Angeles";

function makeImport(partial: Partial<LetterboxdImport> = {}): LetterboxdImport {
  const titles: [string, number][] = [
    ["Heat", 1995],
    ["Dune", 2021],
    ["Past Lives", 2023],
    ["Old Boy", 2003],
    ["Mystery", 2010],
  ];
  const films = Object.fromEntries(
    titles.map(([title, year]) => {
      const key = filmKey(title, year);
      return [key, { key, title, year }];
    }),
  );
  return {
    sourceName: "test.zip",
    importedAt: "2024-01-01T00:00:00.000Z",
    films,
    diary: [],
    ratings: {},
    watchlist: {},
    watched: {},
    ...partial,
  };
}

const HEAT = filmKey("Heat", 1995);
const DUNE = filmKey("Dune", 2021);
const PAST_LIVES = filmKey("Past Lives", 2023);
const OLD_BOY = filmKey("Old Boy", 2003);
const MYSTERY = filmKey("Mystery", 2010);

const resolutions: Record<string, Resolution> = {
  [HEAT]: {
    status: "matched",
    confidence: "exact",
    movie: { trakt: 1, slug: "heat-1995", title: "Heat", year: 1995 },
  },
  [DUNE]: {
    status: "matched",
    confidence: "exact",
    movie: { trakt: 2, slug: "dune-2021", title: "Dune", year: 2021 },
  },
  [PAST_LIVES]: {
    status: "matched",
    confidence: "exact",
    movie: { trakt: 3, slug: "past-lives-2023", title: "Past Lives", year: 2023 },
  },
  [OLD_BOY]: {
    status: "matched",
    confidence: "likely",
    movie: { trakt: 4, slug: "oldboy-2003", title: "Oldboy", year: 2003 },
  },
  [MYSTERY]: { status: "not_found" },
};

const emptyLibrary: TraktLibrary = { plays: {}, ratings: {}, watchlist: {} };

const diary = (
  filmKeyValue: string,
  watchedDate: string,
  id = `${filmKeyValue}@${watchedDate}`,
) => ({
  id,
  filmKey: filmKeyValue,
  watchedDate,
  rating: null,
  rewatch: false,
});

const plan = (imp: LetterboxdImport, library = emptyLibrary, options: Partial<PlanOptions> = {}) =>
  buildPlan(imp, resolutions, library, { ...DEFAULT_OPTIONS, ...options }, TZ);

const find = (films: FilmPlan[], key: string) => {
  const f = films.find((x) => x.film.key === key);
  if (!f) throw new Error(`missing ${key}`);
  return f;
};

describe("history", () => {
  it("adds every diary entry, at local noon", () => {
    const imp = makeImport({ diary: [diary(DUNE, "2024-02-09"), diary(DUNE, "2024-03-01")] });
    const dune = find(plan(imp).films, DUNE);
    expect(dune.status).toBe("sync");
    expect(dune.plays.map((p) => p.watchedAt)).toEqual([
      "2024-02-09T20:00:00.000Z",
      "2024-03-01T20:00:00.000Z",
    ]);
  });

  it("skips entries that already have a play on the same local date", () => {
    const imp = makeImport({ diary: [diary(DUNE, "2024-02-09"), diary(DUNE, "2024-03-01")] });
    // 2024-02-10T05:00Z is the evening of Feb 9 in Los Angeles.
    const library: TraktLibrary = { ...emptyLibrary, plays: { 2: ["2024-02-10T05:00:00.000Z"] } };
    const dune = find(plan(imp, library).films, DUNE);
    expect(dune.playsOnTrakt).toBe(1);
    expect(dune.plays.map((p) => p.date)).toEqual(["2024-03-01"]);
  });

  it("recognizes plays written at UTC midnight by the previous version of this app", () => {
    const imp = makeImport({ diary: [diary(HEAT, "2024-01-01")] });
    const library: TraktLibrary = { ...emptyLibrary, plays: { 1: ["2024-01-01T00:00:00.000Z"] } };
    const heat = find(plan(imp, library).films, HEAT);
    expect(heat.plays).toEqual([]);
    expect(heat.status).toBe("synced");
  });

  it("needs one Trakt play per viewing on the same day", () => {
    const imp = makeImport({
      diary: [diary(HEAT, "2024-01-01", "a"), diary(HEAT, "2024-01-01", "b")],
    });
    const library: TraktLibrary = { ...emptyLibrary, plays: { 1: ["2024-01-01T20:00:00.000Z"] } };
    const heat = find(plan(imp, library).films, HEAT);
    expect(heat.playsOnTrakt).toBe(1);
    expect(heat.plays).toHaveLength(1);
  });

  it("is idempotent: planning again after a sync adds nothing", () => {
    const imp = makeImport({ diary: [diary(DUNE, "2024-02-09"), diary(HEAT, "2023-12-31")] });
    const first = plan(imp);
    const requests = buildRequests(first, selectedByDefault);
    const library: TraktLibrary = { ...emptyLibrary, plays: {} };
    for (const item of requests.history) {
      library.plays[item.trakt] = [...(library.plays[item.trakt] ?? []), item.watchedAt];
    }
    const second = buildRequests(plan(imp, library), selectedByDefault);
    expect(second.history).toEqual([]);
  });

  it("can skip films that already have any play", () => {
    const imp = makeImport({ diary: [diary(DUNE, "2024-02-09")] });
    const library: TraktLibrary = { ...emptyLibrary, plays: { 2: ["2021-10-22T20:00:00.000Z"] } };
    expect(find(plan(imp, library).films, DUNE).plays).toHaveLength(1);
    expect(find(plan(imp, library, { skipWatchedFilms: true }).films, DUNE).plays).toHaveLength(0);
  });

  it("only adds undated films when asked, and only if Trakt has no plays", () => {
    const imp = makeImport({
      watched: { [HEAT]: { date: "2020-05-05" }, [DUNE]: { date: "2022-01-01" } },
    });
    expect(plan(imp).films).toHaveLength(0);
    const library: TraktLibrary = { ...emptyLibrary, plays: { 2: ["2021-10-22T20:00:00.000Z"] } };
    const p = plan(imp, library, { undated: true });
    expect(find(p.films, HEAT).plays).toEqual([
      { diaryId: null, date: "2020-05-05", watchedAt: "2020-05-05T19:00:00.000Z", undated: true },
    ]);
    expect(find(p.films, DUNE).status).toBe("synced");
  });

  it("ignores future dates", () => {
    const imp = makeImport({ diary: [diary(DUNE, "2999-01-01")] });
    expect(find(plan(imp).films, DUNE).plays).toEqual([]);
  });
});

describe("ratings", () => {
  const imp = makeImport({
    ratings: {
      [HEAT]: { rating: 5, date: "2023-05-01" },
      [DUNE]: { rating: 3.5, date: null },
      [PAST_LIVES]: { rating: 4, date: "2024-01-01" },
    },
  });
  const library: TraktLibrary = { ...emptyLibrary, ratings: { 1: 10, 2: 6 } };

  it("adds missing ratings and leaves matching ones alone", () => {
    const p = plan(imp, library);
    expect(find(p.films, HEAT).ratingStatus).toBe("same");
    expect(find(p.films, PAST_LIVES).ratingStatus).toBe("add");
    expect(find(p.films, PAST_LIVES).rating).toMatchObject({ value: 8, stars: 4 });
  });

  it("reports conflicts without overwriting by default", () => {
    const p = plan(imp, library);
    const dune = find(p.films, DUNE);
    expect(dune.ratingStatus).toBe("conflict");
    expect(dune.status).toBe("synced");
    expect(p.counts.ratingConflicts).toBe(1);
    expect(buildRequests(p, selectedByDefault).ratings.map((r) => r.trakt)).toEqual([3]);
  });

  it("overwrites conflicts when asked", () => {
    const p = plan(imp, library, { overwriteRatings: true });
    const dune = find(p.films, DUNE);
    expect(dune.ratingStatus).toBe("overwrite");
    expect(dune.rating?.previous).toBe(6);
    expect(buildRequests(p, selectedByDefault).ratings).toContainEqual({
      trakt: 2,
      rating: 7,
      ratedAt: undefined,
    });
  });
});

describe("watchlist", () => {
  it("adds films not already on the watchlist or watched", () => {
    const imp = makeImport({
      watchlist: { [HEAT]: { date: null }, [DUNE]: { date: null }, [PAST_LIVES]: { date: null } },
    });
    const library: TraktLibrary = {
      plays: { 1: ["2020-01-01T00:00:00.000Z"] },
      ratings: {},
      watchlist: { 2: true },
    };
    const p = plan(imp, library);
    expect(find(p.films, HEAT).watchlistStatus).toBe("watched");
    expect(find(p.films, DUNE).watchlistStatus).toBe("present");
    expect(find(p.films, PAST_LIVES).watchlistStatus).toBe("add");
  });
});

describe("review groups and selection", () => {
  const imp = makeImport({
    diary: [diary(HEAT, "2024-01-01"), diary(OLD_BOY, "2024-01-02"), diary(MYSTERY, "2024-01-03")],
  });
  const p = plan(imp);

  it("groups films for review", () => {
    expect(reviewGroup(find(p.films, HEAT))).toBe("to_sync");
    expect(reviewGroup(find(p.films, OLD_BOY))).toBe("review");
    expect(reviewGroup(find(p.films, MYSTERY))).toBe("not_found");
    expect(p.counts).toMatchObject({ toSync: 1, review: 1, notFound: 1, upToDate: 0 });
  });

  it("leaves likely matches out until the user confirms them", () => {
    expect(buildRequests(p, selectedByDefault).history.map((h) => h.trakt)).toEqual([1]);
    expect(
      buildRequests(p, () => true)
        .history.map((h) => h.trakt)
        .sort(),
    ).toEqual([1, 4]);
  });

  it("marks films without a resolution as unresolved", () => {
    const unresolved = buildPlan(imp, {}, emptyLibrary, DEFAULT_OPTIONS, TZ);
    expect(unresolved.films.every((f) => f.status === "unresolved")).toBe(true);
    expect(buildRequests(unresolved, () => true).history).toEqual([]);
  });
});

describe("filmsToResolve", () => {
  it("only includes films relevant to the chosen options", () => {
    const imp = makeImport({
      diary: [diary(HEAT, "2024-01-01")],
      ratings: { [DUNE]: { rating: 4, date: null } },
      watchlist: { [PAST_LIVES]: { date: null } },
      watched: { [OLD_BOY]: { date: "2020-01-01" } },
    });
    const keys = (o: Partial<PlanOptions>) =>
      filmsToResolve(imp, { ...DEFAULT_OPTIONS, ...o })
        .map((f) => f.key)
        .sort();
    expect(keys({})).toEqual([DUNE, HEAT, PAST_LIVES].sort());
    expect(keys({ undated: true })).toEqual([DUNE, HEAT, OLD_BOY, PAST_LIVES].sort());
    expect(keys({ ratings: false, watchlist: false })).toEqual([HEAT]);
  });
});
