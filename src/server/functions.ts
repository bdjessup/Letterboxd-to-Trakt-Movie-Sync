import { createServerFn } from "@tanstack/react-start";
import type { AppErrorInfo, Resolution, Result, TraktMovieRef, Viewer } from "@/lib/types";
import { ConfigError, getEnv } from "./env";
import { mapWithConcurrency, resolveFilm } from "./resolve";
import { clearSession, oauthClient, readSession, traktApp, withAccessToken } from "./session";
import {
  fetchLibraryPage,
  type LibraryPage,
  pushToTrakt,
  revokeToken,
  searchMovies,
  TraktError,
} from "./trakt";
import {
  ValidationError,
  validateFilmQueries,
  validateLibraryPage,
  validatePush,
  validateSearch,
} from "./validate";

function toErrorInfo(err: unknown): AppErrorInfo {
  if (err instanceof TraktError) {
    return { code: err.code, message: err.message, retryAfter: err.retryAfter };
  }
  if (err instanceof ValidationError) return { code: "bad_request", message: err.message };
  console.error(err);
  if (err instanceof ConfigError) {
    return {
      code: "unavailable",
      message: "This site isn't fully set up yet (missing Trakt credentials).",
    };
  }
  return { code: "unavailable", message: "Something went wrong on our side. Please try again." };
}

async function toResult<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: toErrorInfo(err) };
  }
}

export interface AppState {
  viewer: Viewer | null;
  configured: boolean;
}

export const getAppState = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppState> => {
    let env: ReturnType<typeof getEnv>;
    try {
      env = getEnv();
    } catch (err) {
      console.error(err);
      return { viewer: null, configured: false };
    }
    const session = await readSession(env);
    return { viewer: session?.viewer ?? null, configured: true };
  },
);

export const signOut = createServerFn({ method: "POST" }).handler(async () =>
  toResult(async () => {
    const env = getEnv();
    const session = await readSession(env);
    if (session) {
      // Revoke at Trakt too, but never let that block signing out here.
      await revokeToken(oauthClient(env), session.accessToken).catch((err) =>
        console.warn("Token revocation failed", err),
      );
    }
    await clearSession(env);
    return null;
  }),
);

export const loadLibraryPage = createServerFn({ method: "POST" })
  .validator(validateLibraryPage)
  .handler(({ data }) =>
    toResult((): Promise<LibraryPage> => {
      const env = getEnv();
      return withAccessToken(env, (token) =>
        fetchLibraryPage(traktApp(env), token, data.kind, data.page),
      );
    }),
  );

export const resolveFilms = createServerFn({ method: "POST" })
  .validator(validateFilmQueries)
  .handler(({ data }) =>
    toResult(async (): Promise<{ resolutions: Resolution[]; calls: number }> => {
      const env = getEnv();
      return withAccessToken(env, async (token) => {
        const outcomes = await mapWithConcurrency(data, 4, (film) =>
          resolveFilm(traktApp(env), token, film),
        );
        return {
          resolutions: outcomes.map((o) => o.resolution),
          calls: outcomes.reduce((n, o) => n + o.calls, 0),
        };
      });
    }),
  );

export const findMovies = createServerFn({ method: "POST" })
  .validator(validateSearch)
  .handler(({ data }) =>
    toResult((): Promise<TraktMovieRef[]> => {
      const env = getEnv();
      return withAccessToken(env, (token) =>
        searchMovies(traktApp(env), token, data.query, data.year),
      );
    }),
  );

export const pushChanges = createServerFn({ method: "POST" })
  .validator(validatePush)
  .handler(({ data }) =>
    toResult(() => {
      const env = getEnv();
      return withAccessToken(env, (token) => pushToTrakt(traktApp(env), token, data));
    }),
  );
