import { afterEach, expect, it, vi } from "vitest";
import { CancelledError } from "./client-api";
import { compareImport } from "./compare-import";
import { executeSync } from "./execute-sync";
import { DEFAULT_OPTIONS, type SyncRequests } from "./plan";
import type { LetterboxdImport, PushResult, Resolution, Result } from "./types";

const movie = { trakt: 1, slug: "one", title: "One", year: 2001 };
const imported: LetterboxdImport = {
  sourceName: "test",
  importedAt: "2026-11-15",
  films: {
    one: { key: "one", title: "One", year: 2001 },
    two: { key: "two", title: "Two", year: 2002 },
    three: { key: "three", title: "Three", year: 2003 },
  },
  diary: [],
  ratings: {},
  watched: {},
  watchlist: { one: { date: null }, two: { date: null }, three: { date: null } },
};
const success = (added: number): Result<PushResult> => ({
  ok: true,
  data: { added, existing: 0, notFound: [] },
});
const requests = (): SyncRequests => ({
  history: Array.from({ length: 101 }, (_, trakt) => ({
    trakt,
    watchedAt: "2026-01-01T00:00:00Z",
  })),
  ratings: [{ trakt: 2, rating: 8 }],
  watchlist: [],
});
afterEach(() => vi.useRealTimers());

it("combines paginated library reuse, manual matches and remaining catalog work", async () => {
  const found: Record<string, Resolution> = {
    two: { status: "matched", movie: { ...movie, trakt: 2 }, confidence: "manual" },
  };
  const readPage = vi.fn<Parameters<typeof compareImport>[0]["readPage"]>(async ({ kind, page }) =>
    kind === "history"
      ? {
          ok: true,
          data: {
            kind,
            page,
            pageCount: 2,
            items: [[1, `2026-01-0${page}T00:00:00Z`]],
            movies: [movie],
          },
        }
      : { ok: true, data: { kind: "watchlist", page, pageCount: 1, items: [], movies: [] } },
  );
  const resolve = vi.fn<Parameters<typeof compareImport>[0]["resolve"]>(async (films) => ({
    ok: true,
    data: {
      status: "complete",
      resolutions: films.map(() => ({ status: "not_found" })),
      calls: 1,
      cacheHits: 0,
    },
  }));
  const library = await compareImport({
    imported,
    options: { ...DEFAULT_OPTIONS, history: false, ratings: false, watchlist: true },
    signal: new AbortController().signal,
    getResolutions: () => found,
    readPage,
    resolve,
    onResolved: (batch) => Object.assign(found, batch),
    onProgress: vi.fn(),
  });
  expect(readPage.mock.calls.map(([x]) => [x.kind, x.page])).toEqual([
    ["history", 1],
    ["history", 2],
    ["watchlist", 1],
  ]);
  expect(library.plays[1]).toHaveLength(2);
  expect(resolve.mock.calls[0]?.[0].map((f) => f.key)).toEqual(["three"]);
  expect(found.one).toMatchObject({ status: "matched", confidence: "exact" });
  expect(found.two).toMatchObject({ confidence: "manual" });
  expect(found.three).toEqual({ status: "not_found" });
});

it("ignores a late library reply after cancellation", async () => {
  const controller = new AbortController();
  const onProgress = vi.fn();
  const onResolved = vi.fn();
  const resolve = vi.fn();
  const run = compareImport({
    imported,
    options: DEFAULT_OPTIONS,
    signal: controller.signal,
    getResolutions: () => ({}),
    readPage: async () => {
      controller.abort();
      return {
        ok: true,
        data: { kind: "history", page: 1, pageCount: 1, items: [], movies: [movie] },
      };
    },
    resolve,
    onResolved,
    onProgress,
  });
  await expect(run).rejects.toBeInstanceOf(CancelledError);
  expect(onResolved).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
  expect(onProgress).toHaveBeenCalledTimes(1);
});

it("spaces batches and keeps category ordering", async () => {
  vi.useFakeTimers();
  const times: number[] = [];
  const push = vi.fn<Parameters<typeof executeSync>[0]["push"]>(async (job) => {
    times.push(Date.now());
    return success(job.items.length);
  });
  const run = executeSync({
    requests: requests(),
    signal: new AbortController().signal,
    push,
    onProgress: vi.fn(),
  });
  await vi.runAllTimersAsync();
  const result = await run;
  expect(push.mock.calls.map(([j]) => [j.kind, j.items.length])).toEqual([
    ["history", 100],
    ["history", 1],
    ["ratings", 1],
  ]);
  expect((times[1] ?? NaN) - (times[0] ?? NaN)).toBeGreaterThanOrEqual(1200);
  expect((times[2] ?? NaN) - (times[1] ?? NaN)).toBeGreaterThanOrEqual(1200);
  expect(result.added).toEqual({ history: 101, ratings: 1, watchlist: 0 });
});

it("skips only the category that hits an account limit", async () => {
  vi.useFakeTimers();
  const push = vi.fn<Parameters<typeof executeSync>[0]["push"]>(async (job) =>
    job.kind === "history"
      ? { ok: false, error: { code: "account_limit", message: "Full" } }
      : success(1),
  );
  const run = executeSync({
    requests: requests(),
    signal: new AbortController().signal,
    push,
    onProgress: vi.fn(),
  });
  await vi.runAllTimersAsync();
  const result = await run;
  expect(push.mock.calls.map(([j]) => j.kind)).toEqual(["history", "ratings"]);
  expect(result.added.ratings).toBe(1);
  expect(result.errors).toHaveLength(1);
});

it("stops after an uncertain write without replaying it", async () => {
  const push = vi.fn(async (): Promise<Result<PushResult>> => {
    throw new Error("connection lost");
  });
  const result = await executeSync({
    requests: requests(),
    signal: new AbortController().signal,
    push,
    onProgress: vi.fn(),
  });
  expect(push).toHaveBeenCalledTimes(1);
  expect(result.errors[0]?.code).toBe("network");
});

it("retains an acknowledged write when cancellation arrives during its reply", async () => {
  const controller = new AbortController();
  const onProgress = vi.fn();
  const push = vi.fn(async () => {
    controller.abort();
    return success(100);
  });
  const result = await executeSync({
    requests: requests(),
    signal: controller.signal,
    push,
    onProgress,
  });
  expect(result.cancelled).toBe(true);
  expect(result.added.history).toBe(100);
  expect(push).toHaveBeenCalledTimes(1);
  expect(onProgress).toHaveBeenCalledTimes(1);
});

it("checkpoints completed films before retrying the unfinished comparison", async () => {
  vi.useFakeTimers();
  const found: Record<string, Resolution> = {};
  const resolve = vi
    .fn<Parameters<typeof compareImport>[0]["resolve"]>()
    .mockResolvedValueOnce({
      ok: true,
      data: {
        status: "partial",
        resolutions: [{ status: "not_found" }, null, { status: "not_found" }],
        error: { code: "rate_limited", message: "Wait", retryAfter: 1 },
        calls: 3,
        cacheHits: 0,
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: { status: "complete", resolutions: [{ status: "not_found" }], calls: 1, cacheHits: 0 },
    });
  const run = compareImport({
    imported,
    options: { ...DEFAULT_OPTIONS, history: false, ratings: false, watchlist: true },
    signal: new AbortController().signal,
    getResolutions: () => found,
    readPage: async ({ kind, page }) =>
      kind === "history"
        ? { ok: true, data: { kind, page, pageCount: 1, items: [], movies: [] } }
        : { ok: true, data: { kind: "watchlist", page, pageCount: 1, items: [], movies: [] } },
    resolve,
    onResolved: (batch) => Object.assign(found, batch),
    onProgress: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(Object.keys(found)).toEqual(["one", "three"]);
  await vi.runAllTimersAsync();
  await run;
  expect(resolve.mock.calls.map(([films]) => films.map((f) => f.key))).toEqual([
    ["one", "two", "three"],
    ["two"],
  ]);
  expect(Object.keys(found)).toHaveLength(3);
});
