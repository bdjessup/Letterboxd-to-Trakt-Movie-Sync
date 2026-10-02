import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, CancelledError, callServer, chunk, Pacer } from "./client-api";
import type { Result } from "./types";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (code: "rate_limited" | "unavailable" | "unauthorized", retryAfter?: number) =>
  ({ ok: false, error: { code, message: code, retryAfter } }) as const;

async function settle<T>(promise: Promise<T>) {
  const guarded = promise.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  await vi.runAllTimersAsync();
  return guarded;
}

describe("callServer", () => {
  it("waits out rate limits, reporting the wait", async () => {
    const fn = vi.fn().mockResolvedValueOnce(fail("rate_limited", 3)).mockResolvedValueOnce(ok(1));
    const onWait = vi.fn();
    const r = await settle(
      callServer(fn, { signal: new AbortController().signal, idempotent: false, onWait }),
    );
    expect(r).toEqual({ ok: true, v: 1 });
    expect(onWait).toHaveBeenCalledWith(expect.any(Number));
    expect(onWait).toHaveBeenLastCalledWith(null);
  });

  it("retries transient errors for reads", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(fail("unavailable"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(ok("done"));
    const r = await settle(
      callServer(fn, { signal: new AbortController().signal, idempotent: true }),
    );
    expect(r).toEqual({ ok: true, v: "done" });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("surfaces transient errors for writes instead of retrying", async () => {
    const fn = vi.fn().mockResolvedValue(fail("unavailable"));
    const r = await settle(
      callServer(fn, { signal: new AbortController().signal, idempotent: false }),
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.e).toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry auth failures", async () => {
    const fn = vi.fn().mockResolvedValue(fail("unauthorized"));
    const r = await settle(
      callServer(fn, { signal: new AbortController().signal, idempotent: true }),
    );
    expect(!r.ok && (r.e as ApiError).info.code).toBe("unauthorized");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops when cancelled during a wait", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockResolvedValue(fail("rate_limited", 30));
    const pending = callServer(fn, { signal: controller.signal, idempotent: true });
    const guarded = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    expect(await guarded).toBeInstanceOf(CancelledError);
  });
});

describe("Pacer", () => {
  it("spaces calls to the target rate", async () => {
    const pacer = new Pacer(2);
    const signal = new AbortController().signal;
    const start = Date.now();
    await settle(pacer.spend(4, signal));
    expect(Date.now() - start).toBe(2000);
  });
});

describe("chunk", () => {
  it("splits into fixed-size pieces", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
