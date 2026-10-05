import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, CancelledError, callServer, chunk, Pacer, sleep } from "@/lib/client-api";
import { browserTimeZone } from "@/lib/dates";
import {
  buildPlan,
  buildRequests,
  DEFAULT_OPTIONS,
  type FilmPlan,
  filmsToResolve,
  type PlanOptions,
  type SyncPlan,
  type SyncRequests,
  selectedByDefault,
} from "@/lib/plan";
import { load, remove, removeAll, save } from "@/lib/storage";
import type {
  AppErrorInfo,
  LetterboxdImport,
  LibraryKind,
  PushRequest,
  Resolution,
  Result,
  TraktLibrary,
  TraktMovieRef,
  Viewer,
} from "@/lib/types";
import { loadLibraryPage, pushChanges, resolveFilms } from "@/server/functions";

export type Stage = "upload" | "options" | "analyzing" | "review" | "syncing" | "done";

export interface Progress {
  label: string;
  done: number;
  total: number;
  startedAt: number;
  /** Paused for Trakt's rate limit until this time (epoch ms). */
  waitingUntil: number | null;
}

export interface SyncOutcome {
  added: { history: number; ratings: number; watchlist: number };
  attempted: number;
  /** Trakt ids Trakt couldn't find. */
  notFound: number;
  errors: AppErrorInfo[];
  cancelled: boolean;
}

/** Films resolved per request. Must match the server's MAX_RESOLVE_BATCH. */
const RESOLVE_BATCH = 8;
/** Items per write request. Must not exceed the server's MAX_PUSH_BATCH. */
const PUSH_BATCH = 100;
/** Trakt allows 1,000 GETs per 5 minutes per user; stay comfortably under. */
const READS_PER_SECOND = 3;
/** Trakt allows one write per second per user. */
const WRITE_INTERVAL_MS = 1_200;

const emptyLibrary = (): TraktLibrary => ({ plays: {}, ratings: {}, watchlist: {} });

function toErrorInfo(err: unknown): AppErrorInfo {
  if (err instanceof ApiError) return err.info;
  if (err instanceof Error && err.name === "ImportError") {
    return { code: "bad_request", message: err.message };
  }
  console.error(err);
  return { code: "unavailable", message: "Something unexpected went wrong. Please try again." };
}

/** Save `value` after it settles for `delay` ms. */
function usePersisted<T>(key: string, value: T, enabled: boolean, delay = 0) {
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      if (value === null || value === undefined) void remove(key);
      else void save(key, value);
    }, delay);
    return () => clearTimeout(timer);
  }, [key, value, enabled, delay]);
}

export function useSyncEngine(viewer: Viewer | null) {
  const [hydrated, setHydrated] = useState(false);
  const [stage, setStage] = useState<Stage>("upload");
  const [imported, setImported] = useState<LetterboxdImport | null>(null);
  const [options, setOptions] = useState<PlanOptions>(DEFAULT_OPTIONS);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [library, setLibrary] = useState<TraktLibrary | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<AppErrorInfo | null>(null);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const [busyReading, setBusyReading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const timeZone = viewer?.timeZone ?? browserTimeZone();

  // Restore saved work so a reload (or reconnecting Trakt) doesn't start over.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      load<LetterboxdImport>("import"),
      load<PlanOptions>("options"),
      load<Record<string, Resolution>>("resolutions"),
      load<Record<string, boolean>>("selection"),
    ]).then(([imp, opts, res, sel]) => {
      if (cancelled) return;
      if (imp) {
        setImported(imp);
        setStage("options");
      }
      if (opts) setOptions({ ...DEFAULT_OPTIONS, ...opts });
      if (res) setResolutions(res);
      if (sel) setSelection(sel);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  usePersisted("import", imported, hydrated);
  usePersisted("options", options, hydrated);
  usePersisted("selection", selection, hydrated, 300);
  usePersisted("resolutions", resolutions, hydrated, 1_000);

  const plan: SyncPlan | null = useMemo(() => {
    if (!imported || !library || (stage !== "review" && stage !== "syncing")) return null;
    return buildPlan(imported, resolutions, library, options, timeZone);
  }, [imported, library, resolutions, options, timeZone, stage]);

  const isSelected = useCallback(
    (f: FilmPlan) => selection[f.film.key] ?? selectedByDefault(f),
    [selection],
  );

  const requests: SyncRequests | null = useMemo(
    () => (plan ? buildRequests(plan, isSelected) : null),
    [plan, isSelected],
  );

  // analyze() reads the latest matches when it starts without re-creating itself per batch.
  const resolutionsRef = useRef(resolutions);
  resolutionsRef.current = resolutions;

  const beginTask = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    return controller.signal;
  }, []);

  const setWaiting = useCallback(
    (until: number | null) => setProgress((p) => (p ? { ...p, waitingUntil: until } : p)),
    [],
  );

  // ---------------------------------------------------------------------------------
  // Import

  const loadFile = useCallback(async (file: File) => {
    setBusyReading(true);
    setError(null);
    try {
      // The CSV and ZIP parsers load on demand to keep the first page light.
      const { readExportFile } = await import("@/lib/letterboxd");
      const imp = await readExportFile(file);
      setImported(imp);
      setLibrary(null);
      setOutcome(null);
      setStage("options");
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setBusyReading(false);
    }
  }, []);

  const updateOptions = useCallback((patch: Partial<PlanOptions>) => {
    setOptions((o) => ({ ...o, ...patch }));
  }, []);

  // ---------------------------------------------------------------------------------
  // Analyze: read the Trakt library, then match every film that isn't matched yet.

  const analyze = useCallback(async () => {
    if (!imported) return;
    const signal = beginTask();
    const opts = options;
    setStage("analyzing");
    setOutcome(null);
    const call = <T>(fn: () => Promise<Result<T>>) =>
      callServer(fn, { signal, idempotent: true, onWait: setWaiting });

    try {
      // 1. The user's Trakt library. Plays are also needed to tell whether a
      //    watchlist film has already been watched.
      const kinds: LibraryKind[] = [];
      if (opts.history || opts.watchlist) kinds.push("history");
      if (opts.ratings) kinds.push("ratings");
      if (opts.watchlist) kinds.push("watchlist");

      const lib = emptyLibrary();
      const startedAt = Date.now();
      let pagesDone = 0;
      let pagesKnown = kinds.length;
      setProgress({
        label: "Reading your Trakt library",
        done: 0,
        total: pagesKnown,
        startedAt,
        waitingUntil: null,
      });

      for (const kind of kinds) {
        for (let page = 1, pageCount = 1; page <= pageCount; page++) {
          const res = await call(() => loadLibraryPage({ data: { kind, page } }));
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
          setProgress((p) => p && { ...p, done: pagesDone, total: pagesKnown });
        }
      }

      // 2. Match films on Trakt (cached matches are reused).
      const known = resolutionsRef.current;
      const pending = filmsToResolve(imported, opts).filter((f) => !known[f.key]);
      if (pending.length > 0) {
        setProgress({
          label: "Matching films on Trakt",
          done: 0,
          total: pending.length,
          startedAt: Date.now(),
          waitingUntil: null,
        });
        const pacer = new Pacer(READS_PER_SECOND);
        let done = 0;
        for (const batch of chunk(pending, RESOLVE_BATCH)) {
          const res = await call(() =>
            resolveFilms({ data: { films: batch.map(({ title, year }) => ({ title, year })) } }),
          );
          const found: Record<string, Resolution> = {};
          batch.forEach((film, i) => {
            const r = res.resolutions[i];
            if (r) found[film.key] = r;
          });
          setResolutions((prev) => ({ ...prev, ...found }));
          done += batch.length;
          setProgress((p) => p && { ...p, done });
          await pacer.spend(res.calls, signal);
        }
      }

      setLibrary(lib);
      setProgress(null);
      setStage("review");
    } catch (err) {
      setProgress(null);
      setStage("options");
      if (!(err instanceof CancelledError)) setError(toErrorInfo(err));
    }
  }, [imported, options, beginTask, setWaiting]);

  // ---------------------------------------------------------------------------------
  // Sync

  const sync = useCallback(async () => {
    if (!requests) return;
    const signal = beginTask();
    const jobs: PushRequest[] = [
      ...chunk(requests.history, PUSH_BATCH).map((items) => ({ kind: "history" as const, items })),
      ...chunk(requests.ratings, PUSH_BATCH).map((items) => ({ kind: "ratings" as const, items })),
      ...chunk(requests.watchlist, PUSH_BATCH).map((items) => ({
        kind: "watchlist" as const,
        items,
      })),
    ];
    const total = jobs.reduce((n, j) => n + j.items.length, 0);
    const result: SyncOutcome = {
      added: { history: 0, ratings: 0, watchlist: 0 },
      attempted: total,
      notFound: 0,
      errors: [],
      cancelled: false,
    };
    const skipKinds = new Set<PushRequest["kind"]>();

    setStage("syncing");
    setProgress({
      label: "Sending to Trakt",
      done: 0,
      total,
      startedAt: Date.now(),
      waitingUntil: null,
    });

    let done = 0;
    let lastWrite = 0;
    try {
      for (const job of jobs) {
        if (skipKinds.has(job.kind)) continue;
        const wait = lastWrite + WRITE_INTERVAL_MS - Date.now();
        if (wait > 0) await sleep(wait, signal);
        try {
          const res = await callServer(() => pushChanges({ data: job }), {
            signal,
            idempotent: false,
            onWait: setWaiting,
          });
          result.added[job.kind] += res.added;
          result.notFound += res.notFound.length;
        } catch (err) {
          if (err instanceof CancelledError) throw err;
          const info = toErrorInfo(err);
          result.errors.push(info);
          // Signed out or connection lost: stop. An account limit only affects that list.
          if (info.code === "account_limit") skipKinds.add(job.kind);
          else break;
        } finally {
          lastWrite = Date.now();
        }
        done += job.items.length;
        setProgress((p) => p && { ...p, done });
      }
    } catch (err) {
      if (err instanceof CancelledError) result.cancelled = true;
      else result.errors.push(toErrorInfo(err));
    }

    setOutcome(result);
    setProgress(null);
    setStage("done");
  }, [requests, beginTask, setWaiting]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  // ---------------------------------------------------------------------------------
  // Review edits

  const setFilmSelected = useCallback((keys: string[], selected: boolean) => {
    setSelection((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = selected;
      return next;
    });
  }, []);

  const setManualMatch = useCallback((key: string, movie: TraktMovieRef | null) => {
    setResolutions((prev) => ({
      ...prev,
      [key]: movie ? { status: "matched", movie, confidence: "manual" } : { status: "not_found" },
    }));
    setSelection((prev) => ({ ...prev, [key]: movie !== null }));
  }, []);

  const backToOptions = useCallback(() => {
    abortRef.current?.abort();
    setStage(imported ? "options" : "upload");
    setOutcome(null);
  }, [imported]);

  const startOver = useCallback(() => {
    abortRef.current?.abort();
    setImported(null);
    setLibrary(null);
    setSelection({});
    setOutcome(null);
    setError(null);
    setStage("upload");
  }, []);

  /** Forget everything stored in this browser, including cached matches. */
  const forgetEverything = useCallback(async () => {
    abortRef.current?.abort();
    await removeAll();
    setImported(null);
    setLibrary(null);
    setResolutions({});
    setSelection({});
    setOptions(DEFAULT_OPTIONS);
    setOutcome(null);
    setError(null);
    setStage("upload");
  }, []);

  return {
    hydrated,
    stage,
    imported,
    options,
    resolutions,
    plan,
    requests,
    progress,
    error,
    outcome,
    busyReading,
    timeZone,
    isSelected,
    actions: {
      loadFile,
      updateOptions,
      analyze,
      sync,
      cancel,
      setFilmSelected,
      setManualMatch,
      backToOptions,
      startOver,
      forgetEverything,
      dismissError: () => setError(null),
    },
  };
}

export type SyncEngine = ReturnType<typeof useSyncEngine>;
