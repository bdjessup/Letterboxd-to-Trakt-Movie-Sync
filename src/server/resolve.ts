import { filmKey, pickBestMatch } from "@/lib/matching";
import type { Resolution, TraktMovieRef } from "@/lib/types";
import { searchMovies, type TraktApp } from "./trakt";

export interface FilmQuery {
  title: string;
  year: number | null;
}

const CACHE_PREFIX = "https://edge-cache.invalid/resolve/v1/";
const CACHE_TTL_S = 60 * 60 * 24 * 30;

function edgeCache(): Cache | undefined {
  try {
    return typeof caches === "undefined" ? undefined : caches.default;
  } catch {
    return undefined;
  }
}

/** Exact matches don't change, so they're shared across users via Cloudflare's cache. */
async function readCached(key: string): Promise<TraktMovieRef | null> {
  try {
    const hit = await edgeCache()?.match(CACHE_PREFIX + encodeURIComponent(key));
    return hit ? ((await hit.json()) as TraktMovieRef) : null;
  } catch {
    return null;
  }
}

async function writeCached(key: string, movie: TraktMovieRef): Promise<void> {
  try {
    await edgeCache()?.put(
      CACHE_PREFIX + encodeURIComponent(key),
      Response.json(movie, { headers: { "Cache-Control": `public, max-age=${CACHE_TTL_S}` } }),
    );
  } catch {
    // Best effort only.
  }
}

export interface ResolveOutcome {
  resolution: Resolution;
  /** Trakt API calls made, so the client can pace itself. */
  calls: number;
}

/**
 * Find a Letterboxd film on Trakt: first searching that exact year, then (if that
 * didn't produce an exact match) without a year filter to catch off-by-one release years.
 */
export async function resolveFilm(
  app: TraktApp,
  token: string,
  film: FilmQuery,
): Promise<ResolveOutcome> {
  const key = filmKey(film.title, film.year);
  const cached = await readCached(key);
  if (cached)
    return { resolution: { status: "matched", movie: cached, confidence: "exact" }, calls: 0 };

  let calls = 1;
  const first = await searchMovies(app, token, film.title, film.year);
  let match = pickBestMatch(film.title, film.year, first, { yearFiltered: film.year != null });

  if (match?.confidence !== "exact" && film.year != null) {
    calls++;
    const broader = await searchMovies(app, token, film.title, null);
    const alt = pickBestMatch(film.title, film.year, broader);
    if (alt && (!match || alt.confidence === "exact")) match = alt;
  }

  if (!match) return { resolution: { status: "not_found" }, calls };
  if (match.confidence === "exact") await writeCached(key, match.movie);
  return {
    resolution: { status: "matched", movie: match.movie, confidence: match.confidence },
    calls,
  };
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
