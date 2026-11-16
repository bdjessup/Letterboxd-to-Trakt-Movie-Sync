import type { ResolveBatchResult } from "@/server/resolve";
import type { LibraryPage } from "@/server/trakt";
import { CancelledError, callServer, chunk } from "./client-api";
import { resolveFromLibrary } from "./library-matches";
import { filmsToResolve, type PlanOptions } from "./plan";
import { resolvePendingFilms } from "./resolve-pending";
import { assertActive, type Progress } from "./sync-run";
import type {
  Film,
  LetterboxdImport,
  LibraryKind,
  Resolution,
  Result,
  TraktLibrary,
  TraktMovieRef,
} from "./types";

export async function compareImport({
  imported,
  options: opts,
  signal,
  getResolutions,
  readPage,
  resolve,
  onResolved,
  onProgress,
}: {
  imported: LetterboxdImport;
  options: PlanOptions;
  signal: AbortSignal;
  getResolutions: () => Record<string, Resolution>;
  readPage: (input: { kind: LibraryKind; page: number }) => Promise<Result<LibraryPage>>;
  resolve: (films: Film[]) => Promise<Result<ResolveBatchResult>>;
  onResolved: (found: Record<string, Resolution>) => void;
  onProgress: (progress: Progress) => void;
}): Promise<TraktLibrary> {
  assertActive(signal);
  let progress: Progress = {
    label: "",
    done: 0,
    total: 0,
    startedAt: Date.now(),
    waitingUntil: null,
  };
  const report = (next: Progress) => {
    assertActive(signal);
    progress = next;
    onProgress(next);
  };
  const setWaiting = (until: number | null) => {
    if (!signal.aborted) report({ ...progress, waitingUntil: until });
  };
  const call = <T>(fn: () => Promise<Result<T>>) =>
    callServer(fn, { signal, idempotent: true, onWait: setWaiting });
  const emptyLibrary = (): TraktLibrary => ({ plays: {}, ratings: {}, watchlist: {} });
  const RESOLVE_BATCH = 8;
  // 1. The user's Trakt library. Plays are also needed to tell whether a
  //    watchlist film has already been watched.
  const kinds: LibraryKind[] = [];
  if (opts.history || opts.watchlist) kinds.push("history");
  if (opts.ratings) kinds.push("ratings");
  if (opts.watchlist) kinds.push("watchlist");

  const lib = emptyLibrary();
  const libraryMovies: TraktMovieRef[] = [];
  const startedAt = Date.now();
  let pagesDone = 0;
  let pagesKnown = kinds.length;
  report({
    label: "Reading your Trakt library",
    done: 0,
    total: pagesKnown,
    startedAt,
    waitingUntil: null,
  });

  for (const kind of kinds) {
    for (let page = 1, pageCount = 1; page <= pageCount; page++) {
      const res = await call(() => readPage({ kind, page }));
      if (signal.aborted) throw new CancelledError("Cancelled");
      libraryMovies.push(...res.movies);
      if (page === 1) pagesKnown += res.pageCount - 1;
      pageCount = res.pageCount;
      if (res.kind === "history") {
        for (const [id, at] of res.items) {
          const plays = lib.plays[id];
          if (plays) plays.push(at);
          else lib.plays[id] = [at];
        }
      } else if (res.kind === "ratings") {
        for (const [id, rating] of res.items) lib.ratings[id] = rating;
      } else {
        for (const id of res.items) lib.watchlist[id] = true;
      }
      pagesDone++;
      report({ ...progress, done: pagesDone, total: pagesKnown });
    }
  }

  // 2. Match films on Trakt (cached matches are reused).
  const cached = getResolutions();
  const targets = filmsToResolve(imported, opts);
  const reused = resolveFromLibrary(
    targets.filter((film) => cached[film.key]?.status !== "matched"),
    libraryMovies,
  );
  if (signal.aborted) throw new CancelledError("Cancelled");
  if (Object.keys(reused).length) onResolved(reused);
  const known = { ...cached, ...reused };
  const pending = targets.filter((f) => known[f.key]?.status !== "matched");
  if (pending.length > 0) {
    report({
      label: "Matching films on Trakt",
      done: 0,
      total: pending.length,
      startedAt: Date.now(),
      waitingUntil: null,
    });
    let done = 0;
    for (const batch of chunk(pending, RESOLVE_BATCH)) {
      await resolvePendingFilms({
        films: batch,
        signal,
        resolve: (films) => resolve(films),
        onWait: setWaiting,
        onResolved: (found) => {
          onResolved(found);
          done += Object.keys(found).length;
          report({ ...progress, done });
        },
      });
    }
  }

  if (signal.aborted) throw new CancelledError("Cancelled");

  return lib;
}
