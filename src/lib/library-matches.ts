import { filmKey } from "./matching";
import type { Film, Resolution, TraktMovieRef } from "./types";

/** Reuse unambiguous title/year identities already returned with the user's library. */
export function resolveFromLibrary(
  films: Film[],
  movies: TraktMovieRef[],
): Record<string, Resolution> {
  // Keep collisions by key, even if a later snapshot changes one movie's title or year.
  const identities = new Map<string, TraktMovieRef | null>();
  for (const movie of movies) {
    if (movie.year === null) continue;
    const key = filmKey(movie.title, movie.year);
    const existing = identities.get(key);
    if (existing === undefined) identities.set(key, movie);
    else if (existing !== null && existing.trakt !== movie.trakt) identities.set(key, null);
  }

  const resolutions: Record<string, Resolution> = {};
  for (const film of films) {
    if (film.year === null) continue;
    const movie = identities.get(filmKey(film.title, film.year));
    if (movie) resolutions[film.key] = { status: "matched", movie, confidence: "exact" };
  }
  return resolutions;
}
