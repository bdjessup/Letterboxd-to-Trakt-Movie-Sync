import { describe, expect, it } from "vitest";
import { resolveFromLibrary } from "./library-matches";
import { filmKey } from "./matching";
import type { Film, TraktMovieRef } from "./types";

const film = (title: string, year: number | null): Film => ({
  key: filmKey(title, year),
  title,
  year,
});

const movie = (trakt: number, title: string, year: number | null): TraktMovieRef => ({
  trakt,
  slug: `movie-${trakt}`,
  title,
  year,
});

describe("resolveFromLibrary", () => {
  it("reuses exact library identities while leaving different releases for search", () => {
    const dune = movie(1, "Dune", 1984);
    expect(
      resolveFromLibrary(
        [film("Dune", 1984), film("Dune", 2021), film("Parasite", 2020)],
        [dune, movie(2, "Parasite", 2019)],
      ),
    ).toEqual({ "dune|1984": { status: "matched", movie: dune, confidence: "exact" } });
  });

  it("uses the same title normalization as export matching", () => {
    const amelie = movie(4, "Amélie!", 2001);
    expect(resolveFromLibrary([film("AMELIE", 2001)], [amelie])).toEqual({
      "amelie|2001": { status: "matched", movie: amelie, confidence: "exact" },
    });
    expect(resolveFromLibrary([film("The Thing", 1982)], [movie(5, "Thing", 1982)])).toEqual({});
  });

  it("does not infer an exact identity when either year is unknown", () => {
    expect(
      resolveFromLibrary(
        [film("Dune", null), film("Unknown", 2000), film("Untitled", null)],
        [movie(1, "Dune", 1984), movie(2, "Unknown", null), movie(3, "Untitled", null)],
      ),
    ).toEqual({});
  });

  it("accepts repeated library entries for the same movie", () => {
    const heat = movie(6, "Heat", 1995);
    expect(resolveFromLibrary([film("Heat", 1995)], [heat, { ...heat }, heat])).toEqual({
      "heat|1995": { status: "matched", movie: heat, confidence: "exact" },
    });
  });

  it("leaves same-title same-year collisions unresolved regardless of duplicate ordering", () => {
    const one = movie(1, "The Same Film", 2001);
    const two = movie(2, "The Same Film", 2001);
    const wanted = [film("The Same Film", 2001)];
    expect(resolveFromLibrary(wanted, [one, two, one])).toEqual({});
    expect(resolveFromLibrary(wanted, [two, one, two])).toEqual({});
  });

  it("does not erase a collision when a movie has another title or year snapshot", () => {
    const original = movie(1, "Heat", 1995);
    const collision = movie(2, "Heat", 1995);
    const changed = movie(1, "Heat", 1996);
    expect(resolveFromLibrary([film("Heat", 1995)], [original, collision, changed])).toEqual({});
    expect(resolveFromLibrary([film("Heat", 1995)], [changed, collision, original])).toEqual({});
  });
});
