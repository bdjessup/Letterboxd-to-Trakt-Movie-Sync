import type { AppErrorInfo, Result } from "./types";

/** Stay below Trakt's Standard limit of 500 GETs per five minutes. */
export const TRAKT_READS_PER_SECOND = 1.5;

export class ApiError extends Error {
  override name = "ApiError";
  constructor(readonly info: AppErrorInfo) {
    super(info.message);
  }
}

export class CancelledError extends Error {
  override name = "CancelledError";
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError("Cancelled"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError("Cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface CallOptions {
  signal: AbortSignal;
  /**
   * Retry network and server errors. Only safe for reads: a write that failed mid-flight
   * may have been applied, so it's surfaced instead (re-checking finds what landed).
   */
  idempotent: boolean;
  /** Told when we're waiting out a rate limit (epoch ms), and null when done. */
  onWait?: (until: number | null) => void;
}

const MAX_RATE_LIMIT_WAITS = 12;
const RETRY_DELAYS_MS = [2_000, 5_000, 12_000];

/** Call a server function, waiting out rate limits and retrying transient failures. */
export async function callServer<T>(
  fn: () => Promise<Result<T>>,
  { signal, idempotent, onWait }: CallOptions,
): Promise<T> {
  let rateLimitWaits = 0;
  let failures = 0;

  for (;;) {
    if (signal.aborted) throw new CancelledError("Cancelled");

    let result: Result<T>;
    try {
      result = await fn();
    } catch {
      result = {
        ok: false,
        error: {
          code: "network",
          message: "Lost connection to the server. Check your internet connection.",
        },
      };
    }
    if (result.ok) return result.data;

    const { error } = result;
    if (error.code === "rate_limited" && rateLimitWaits < MAX_RATE_LIMIT_WAITS) {
      rateLimitWaits++;
      const waitMs = Math.min(Math.max(error.retryAfter ?? 10, 1), 300) * 1000;
      onWait?.(Date.now() + waitMs);
      try {
        await sleep(waitMs, signal);
      } finally {
        onWait?.(null);
      }
      continue;
    }

    const transient = error.code === "network" || error.code === "unavailable";
    if (transient && idempotent && failures < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[failures++] ?? 0, signal);
      continue;
    }
    throw new ApiError(error);
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
