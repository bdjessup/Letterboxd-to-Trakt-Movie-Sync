import { filmKey, pickBestMatch } from "@/lib/matching";
import type { AppErrorInfo, ErrorCode, Resolution, TraktMovieRef } from "@/lib/types";
import { searchMovies, type TraktApp, TraktError } from "./trakt";

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

export type ResolveBatchResult =
  | { status: "complete"; resolutions: Resolution[]; calls: number; cacheHits: number }
  | {
      status: "partial";
      resolutions: (Resolution | null)[];
      calls: number;
      cacheHits: number;
      error: AppErrorInfo;
    };

const ERROR_PRIORITY: Record<ErrorCode, number> = {
  unauthorized: 3,
  account_limit: 3,
  bad_request: 3,
  network: 2,
  unavailable: 2,
  rate_limited: 1,
};

/** Preserve finished films, stop scheduling after a failure, and drain in-flight work. */
export async function resolveBatch(
  app: TraktApp,
  token: string,
  films: FilmQuery[],
): Promise<ResolveBatchResult> {
  const outcomes: (ResolveOutcome | null)[] = Array.from({ length: films.length }, () => null);
  const errors: unknown[] = [];
  let next = 0;
  let stopped = false;
  const workers = Array.from({ length: Math.min(4, films.length) }, async () => {
    while (!stopped) {
      const film = films[next];
      if (!film) return;
      const index = next++;
      try {
        outcomes[index] = await resolveFilm(app, token, film);
      } catch (error) {
        stopped = true;
        errors.push(error);
      }
    }
  });
  await Promise.all(workers);

  let errorInfo: AppErrorInfo | null = null;
  for (const error of errors) {
    if (!(error instanceof TraktError)) throw error;
    const info: AppErrorInfo = {
      code: error.code,
      message: error.message,
      retryAfter: error.retryAfter,
    };
    if (!errorInfo || ERROR_PRIORITY[info.code] > ERROR_PRIORITY[errorInfo.code]) {
      errorInfo = info;
    } else if (info.code === "rate_limited" && errorInfo.code === "rate_limited") {
      errorInfo.retryAfter = Math.max(errorInfo.retryAfter ?? 0, info.retryAfter ?? 0) || undefined;
    }
  }

  const calls = outcomes.reduce((total, outcome) => total + (outcome?.calls ?? 0), 0);
  const cacheHits = outcomes.filter((outcome) => outcome?.calls === 0).length;
  if (errorInfo) {
    return {
      status: "partial",
      resolutions: outcomes.map((outcome) => outcome?.resolution ?? null),
      calls,
      cacheHits,
      error: errorInfo,
    };
  }
  return {
    status: "complete",
    resolutions: outcomes.flatMap((outcome) => outcome?.resolution ?? []),
    calls,
    cacheHits,
  };
}
