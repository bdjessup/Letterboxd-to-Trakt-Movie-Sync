import { describe, expect, it } from "vitest";
import { filmKey, normalizeTitle, pickBestMatch, similarity, toTraktRating } from "./matching";
import type { TraktMovieRef } from "./types";

const movie = (trakt: number, title: string, year: number | null): TraktMovieRef => ({
  trakt,
  slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${year}`,
  title,
  year,
});

describe("normalizeTitle", () => {
  it("ignores case, accents, punctuation and ampersands", () => {
    expect(normalizeTitle("Amélie")).toBe("amelie");
    expect(normalizeTitle("Crouching Tiger, Hidden Dragon")).toBe("crouching tiger hidden dragon");
    expect(normalizeTitle("Fast & Furious")).toBe("fast and furious");
    expect(normalizeTitle("Schindler’s List")).toBe("schindlers list");
    expect(normalizeTitle("  WALL·E ")).toBe("wall e");
  });

  it("keeps non-Latin scripts", () => {
    expect(normalizeTitle("千と千尋の神隠し")).toBe("千と千尋の神隠し");
  });

  it("builds stable keys", () => {
    expect(filmKey("The Matrix", 1999)).toBe("the matrix|1999");
    expect(filmKey("Untitled", null)).toBe("untitled|");
  });
});

describe("similarity", () => {
  it("scores identical strings 1 and unrelated strings near 0", () => {
    expect(similarity("night", "night")).toBe(1);
    expect(similarity("night", "nacht")).toBeLessThan(0.5);
  });
});

describe("pickBestMatch", () => {
  it("prefers an exact title and year over Trakt's ranking", () => {
    const results = [
      movie(1, "Dune: Part Two", 2024),
      movie(2, "Dune", 2021),
      movie(3, "Dune", 1984),
    ];
    expect(pickBestMatch("Dune", 2021, results)).toEqual({
      movie: results[1],
      confidence: "exact",
    });
    expect(pickBestMatch("Dune", 1984, results)?.movie.trakt).toBe(3);
  });

  it("treats an off-by-one year as likely, not exact", () => {
    const results = [movie(10, "Parasite", 2019)];
    expect(pickBestMatch("Parasite", 2020, results)).toEqual({
      movie: results[0],
      confidence: "likely",
    });
  });

  it("matches despite punctuation and leading articles", () => {
    expect(pickBestMatch("Amelie", 2001, [movie(4, "Amélie", 2001)])?.confidence).toBe("exact");
    expect(pickBestMatch("The Thing", 1982, [movie(5, "Thing", 1982)])?.confidence).toBe("likely");
  });

  it("accepts Trakt's top hit for a year-filtered search as likely", () => {
    const results = [movie(6, "Spirited Away", 2001)];
    expect(
      pickBestMatch("Sen to Chihiro no Kamikakushi", 2001, results, { yearFiltered: true }),
    ).toEqual({
      movie: results[0],
      confidence: "likely",
    });
    expect(pickBestMatch("Sen to Chihiro no Kamikakushi", 2001, results)).toBeNull();
  });

  it("rejects same-title films from other decades", () => {
    expect(pickBestMatch("Suspiria", 2018, [movie(7, "Suspiria", 1977)])).toBeNull();
  });

  it("returns null with no results", () => {
    expect(pickBestMatch("Anything", 2000, [])).toBeNull();
  });
});

describe("toTraktRating", () => {
  it("maps half stars to the 1–10 scale", () => {
    expect(toTraktRating(0.5)).toBe(1);
    expect(toTraktRating(2.5)).toBe(5);
    expect(toTraktRating(4.5)).toBe(9);
    expect(toTraktRating(5)).toBe(10);
  });

  it("clamps out-of-range input", () => {
    expect(toTraktRating(0)).toBe(1);
    expect(toTraktRating(7)).toBe(10);
  });
});
