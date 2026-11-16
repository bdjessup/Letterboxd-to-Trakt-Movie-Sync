import { createServerFn } from "@tanstack/react-start";
import type { AppErrorInfo, Resolution, Result, TraktMovieRef, Viewer } from "@/lib/types";
import { ConfigError, getEnv } from "./env";
import { type ResolveBatchResult, resolveBatch } from "./resolve";
import { clearSession, oauthClient, readSession, traktApp, withAccessToken } from "./session";
import {
  fetchLibraryPage,
  type LibraryPage,
  pushToTrakt,
  revokeToken,
  searchMovies,
  type TraktApp,
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

async function measuredRead<T>(
  app: TraktApp,
  kind: string,
  read: () => Promise<T>,
  counts: Record<string, number> = {},
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await read();
  } finally {
    console.info({
      event: "trakt_read_summary",
      kind,
      ...counts,
      ...app.readMetrics,
      durationMs: Date.now() - startedAt,
    });
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
      return withAccessToken(env, (token, viewer) => {
        const app = traktApp(env, viewer);
        return measuredRead(app, data.kind, () =>
          fetchLibraryPage(app, token, data.kind, data.page),
        );
      });
    }),
  );

export const resolveFilms = createServerFn({ method: "POST" })
  .validator(validateFilmQueries)
  .handler(({ data }) =>
    toResult(async (): Promise<ResolveBatchResult> => {
      const env = getEnv();
      const resolutions: (Resolution | null)[] = data.map(() => null);
      let calls = 0;
      let cacheHits = 0;
      try {
        return await withAccessToken(env, (token, viewer) => {
          const app = traktApp(env, viewer);
          const pending = data.flatMap((film, index) =>
            resolutions[index] ? [] : [{ film, index }],
          );
          const counts = { requested: pending.length, completed: 0, cacheHits: 0 };
          return measuredRead(
            app,
            "resolve",
            async () => {
              const batch = await resolveBatch(
                app,
                token,
                pending.map(({ film }) => film),
              );
              for (const [index, resolution] of batch.resolutions.entries()) {
                const original = pending[index];
                if (resolution && original) resolutions[original.index] = resolution;
              }
              calls += batch.calls;
              cacheHits += batch.cacheHits;
              counts.completed = batch.resolutions.filter(Boolean).length;
              counts.cacheHits = batch.cacheHits;
              if (batch.status === "partial") {
                if (batch.error.code === "unauthorized") {
                  throw new TraktError(401, "unauthorized", batch.error.message);
                }
                return { ...batch, resolutions, calls, cacheHits };
              }
              return {
                status: "complete",
                resolutions: resolutions.flatMap((resolution) => (resolution ? [resolution] : [])),
                calls,
                cacheHits,
              };
            },
            counts,
          );
        });
      } catch (error) {
        return {
          status: "partial",
          resolutions,
          calls,
          cacheHits,
          error: toErrorInfo(error),
        };
      }
    }),
  );

export const findMovies = createServerFn({ method: "POST" })
  .validator(validateSearch)
  .handler(({ data }) =>
    toResult((): Promise<TraktMovieRef[]> => {
      const env = getEnv();
      return withAccessToken(env, (token, viewer) => {
        const app = traktApp(env, viewer);
        return measuredRead(app, "manual_search", () =>
          searchMovies(app, token, data.query, data.year),
        );
      });
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
