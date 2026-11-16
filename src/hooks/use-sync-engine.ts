import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, CancelledError } from "@/lib/client-api";
import { compareImport } from "@/lib/compare-import";
import { browserTimeZone } from "@/lib/dates";
import { executeSync } from "@/lib/execute-sync";
import {
  buildPlan,
  buildRequests,
  DEFAULT_OPTIONS,
  type FilmPlan,
  type PlanOptions,
  type SyncPlan,
  type SyncRequests,
  selectedByDefault,
} from "@/lib/plan";
import { load, remove, removeAll, save } from "@/lib/storage";
import type { Progress, SyncOutcome } from "@/lib/sync-run";
import type {
  AppErrorInfo,
  LetterboxdImport,
  Resolution,
  TraktLibrary,
  TraktMovieRef,
  Viewer,
} from "@/lib/types";
import { loadLibraryPage, pushChanges, resolveFilms } from "@/server/functions";

export type Stage = "upload" | "options" | "analyzing" | "review" | "syncing" | "done";

export type { Progress, SyncOutcome } from "@/lib/sync-run";

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

  // ---------------------------------------------------------------------------------
  // Import

  const loadFile = useCallback(
    async (file: File) => {
      const signal = beginTask();
      setBusyReading(true);
      setError(null);
      try {
        // The CSV and ZIP parsers load on demand to keep the first page light.
        const { readExportFile } = await import("@/lib/letterboxd");
        const imp = await readExportFile(file);
        if (signal.aborted) return;
        setImported(imp);
        setSelection({});
        setLibrary(null);
        setOutcome(null);
        setStage("options");
      } catch (err) {
        if (signal.aborted) return;
        setError(toErrorInfo(err));
      } finally {
        if (abortRef.current?.signal === signal) setBusyReading(false);
      }
    },
    [beginTask],
  );

  const updateOptions = useCallback((patch: Partial<PlanOptions>) => {
    setOptions((o) => ({ ...o, ...patch }));
  }, []);

  // ---------------------------------------------------------------------------------
  // Analyze: read the Trakt library, then match every film that isn't matched yet.

  const analyze = useCallback(async () => {
    if (!imported) return;
    const signal = beginTask();
    setStage("analyzing");
    setOutcome(null);
    try {
      const lib = await compareImport({
        imported,
        options,
        signal,
        getResolutions: () => resolutionsRef.current,
        readPage: (data) => loadLibraryPage({ data }),
        resolve: (films) =>
          resolveFilms({ data: { films: films.map(({ title, year }) => ({ title, year })) } }),
        onResolved: (found) => {
          if (abortRef.current?.signal === signal && !signal.aborted)
            setResolutions((prev) => ({ ...prev, ...found }));
        },
        onProgress: (next) => {
          if (abortRef.current?.signal === signal && !signal.aborted) setProgress(next);
        },
      });
      if (abortRef.current?.signal !== signal || signal.aborted) return;
      setLibrary(lib);
      setProgress(null);
      setStage("review");
    } catch (err) {
      if (abortRef.current?.signal !== signal) return;
      setProgress(null);
      setStage("options");
      if (!(err instanceof CancelledError)) setError(toErrorInfo(err));
    }
  }, [imported, options, beginTask]);

  // ---------------------------------------------------------------------------------
  // Sync

  const sync = useCallback(async () => {
    if (!requests) return;
    const signal = beginTask();
    setStage("syncing");
    const result = await executeSync({
      requests,
      signal,
      push: (data) => pushChanges({ data }),
      onProgress: (next) => {
        if (abortRef.current?.signal === signal && !signal.aborted) setProgress(next);
      },
    });

    if (abortRef.current?.signal !== signal) return;
    setOutcome(result);
    setProgress(null);
    setStage("done");
  }, [requests, beginTask]);

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
    abortRef.current = null;
    setImported(null);
    setBusyReading(false);
    setLibrary(null);
    setSelection({});
    setOutcome(null);
    setError(null);
    setStage("upload");
  }, []);

  /** Forget everything stored in this browser, including cached matches. */
  const forgetEverything = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    await removeAll();
    setImported(null);
    setBusyReading(false);
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
