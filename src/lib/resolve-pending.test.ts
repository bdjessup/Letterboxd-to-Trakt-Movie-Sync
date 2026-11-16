import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolveBatchResult } from "@/server/resolve";
import { CancelledError } from "./client-api";
import { resolvePendingFilms } from "./resolve-pending";
import type { AppErrorInfo, Film, Resolution, Result } from "./types";

const films: Film[] = [
  { key: "one|2001", title: "One", year: 2001 },
  { key: "two|2002", title: "Two", year: 2002 },
  { key: "three|2003", title: "Three", year: 2003 },
];
const one: Resolution = {
  status: "matched",
  confidence: "exact",
  movie: { trakt: 1, slug: "one", title: "One", year: 2001 },
};
const two: Resolution = { status: "not_found" };
const three: Resolution = {
  status: "matched",
  confidence: "likely",
  movie: { trakt: 3, slug: "three", title: "Three", year: 2003 },
};
const ok = (data: ResolveBatchResult): Result<ResolveBatchResult> => ({ ok: true, data });
const complete = (resolutions: Resolution[]) =>
  ok({ status: "complete", resolutions, calls: resolutions.length, cacheHits: 0 });
const partial = (resolutions: (Resolution | null)[], error: AppErrorInfo) =>
  ok({ status: "partial", resolutions, error, calls: 1, cacheHits: 0 });
const resolveMock = () => vi.fn<(films: Film[]) => Promise<Result<ResolveBatchResult>>>();

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("resolvePendingFilms", () => {
  it("checkpoints partial successes before waiting and retries only unfinished films", async () => {
    const resolve = resolveMock()
      .mockResolvedValueOnce(
        partial([one, null, three], { code: "rate_limited", message: "Wait", retryAfter: 30 }),
      )
      .mockResolvedValueOnce(complete([two]));
    const onResolved = vi.fn();
    const onWait = vi.fn();
    const pending = resolvePendingFilms({
      films,
      signal: new AbortController().signal,
      resolve,
      onResolved,
      onWait,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onResolved.mock.calls).toEqual([[{ "one|2001": one, "three|2003": three }]]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(onWait).toHaveBeenCalledWith(expect.any(Number));
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(resolve.mock.calls.map(([batch]) => batch.map((film) => film.key))).toEqual([
      ["one|2001", "two|2002", "three|2003"],
      ["two|2002"],
    ]);
    expect(onResolved.mock.calls).toEqual([
      [{ "one|2001": one, "three|2003": three }],
      [{ "two|2002": two }],
    ]);
    expect(onWait).toHaveBeenLastCalledWith(null);
  });

  it("preserves completed films before surfacing a fatal partial error", async () => {
    const error: AppErrorInfo = { code: "unauthorized", message: "Reconnect Trakt" };
    const resolve = resolveMock().mockResolvedValue(partial([one, null, three], error));
    const onResolved = vi.fn();
    await expect(
      resolvePendingFilms({ films, signal: new AbortController().signal, resolve, onResolved }),
    ).rejects.toMatchObject({ info: error });
    expect(onResolved.mock.calls).toEqual([[{ "one|2001": one, "three|2003": three }]]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("keeps completed films out of later network retries", async () => {
    const resolve = resolveMock()
      .mockResolvedValueOnce(partial([one, null, three], { code: "network", message: "Offline" }))
      .mockRejectedValueOnce(new TypeError("Connection lost"))
      .mockResolvedValueOnce(complete([two]));
    const onResolved = vi.fn();
    const pending = resolvePendingFilms({
      films,
      signal: new AbortController().signal,
      resolve,
      onResolved,
    });
    await vi.runAllTimersAsync();
    await pending;
    expect(resolve.mock.calls.map(([batch]) => batch.map((film) => film.key))).toEqual([
      ["one|2001", "two|2002", "three|2003"],
      ["two|2002"],
      ["two|2002"],
    ]);
    expect(onResolved.mock.calls).toEqual([
      [{ "one|2001": one, "three|2003": three }],
      [{ "two|2002": two }],
    ]);
  });

  it("stops retrying when cancelled during a rate-limit wait", async () => {
    const controller = new AbortController();
    const resolve = resolveMock().mockResolvedValue(
      partial([one, null, three], { code: "rate_limited", message: "Wait", retryAfter: 30 }),
    );
    const onResolved = vi.fn();
    const pending = resolvePendingFilms({ films, signal: controller.signal, resolve, onResolved });
    const rejected = expect(pending).rejects.toBeInstanceOf(CancelledError);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(onResolved.mock.calls).toEqual([[{ "one|2001": one, "three|2003": three }]]);
  });

  it("discards a response that arrives after cancellation", async () => {
    const controller = new AbortController();
    const resolve = resolveMock().mockImplementation(async () => {
      controller.abort();
      return complete([one, two, three]);
    });
    const onResolved = vi.fn();
    await expect(
      resolvePendingFilms({ films, signal: controller.signal, resolve, onResolved }),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(onResolved).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong number of results", complete([one])],
    [
      "partial with no unfinished films",
      partial([one, two, three], { code: "rate_limited", message: "Wait" }),
    ],
  ])("rejects a malformed response with %s", async (_label, result) => {
    const resolve = resolveMock().mockResolvedValue(result);
    const onResolved = vi.fn();
    await expect(
      resolvePendingFilms({ films, signal: new AbortController().signal, resolve, onResolved }),
    ).rejects.toMatchObject({ info: { code: "bad_request" } });
    expect(onResolved).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("makes no request when the batch is empty", async () => {
    const resolve = resolveMock();
    const onResolved = vi.fn();
    await resolvePendingFilms({
      films: [],
      signal: new AbortController().signal,
      resolve,
      onResolved,
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(onResolved).not.toHaveBeenCalled();
  });
});
