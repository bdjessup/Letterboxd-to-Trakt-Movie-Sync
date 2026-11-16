import { ApiError, CancelledError, callServer, chunk, sleep } from "./client-api";
import type { SyncRequests } from "./plan";
import type { Progress, SyncOutcome } from "./sync-run";
import type { AppErrorInfo, PushRequest, PushResult, Result } from "./types";

const PUSH_BATCH = 100;
const WRITE_INTERVAL_MS = 1_200;
function toErrorInfo(error: unknown): AppErrorInfo {
  return error instanceof ApiError
    ? error.info
    : { code: "unavailable", message: "Something unexpected went wrong. Please try again." };
}
export async function executeSync({
  requests,
  signal,
  push,
  onProgress,
}: {
  requests: SyncRequests;
  signal: AbortSignal;
  push: (request: PushRequest) => Promise<Result<PushResult>>;
  onProgress: (progress: Progress) => void;
}): Promise<SyncOutcome> {
  let progress: Progress = {
    label: "",
    done: 0,
    total: 0,
    startedAt: Date.now(),
    waitingUntil: null,
  };
  const report = (next: Progress) => {
    progress = next;
    if (!signal.aborted) onProgress(next);
  };
  const setWaiting = (until: number | null) => report({ ...progress, waitingUntil: until });
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

  report({
    label: "Sending to Trakt",
    done: 0,
    total,
    startedAt: Date.now(),
    waitingUntil: null,
  });

  let done = 0;
  let lastWrite = 0;
  try {
    if (signal.aborted) throw new CancelledError("Cancelled");
    for (const job of jobs) {
      if (signal.aborted) throw new CancelledError("Cancelled");
      if (skipKinds.has(job.kind)) continue;
      const wait = lastWrite + WRITE_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait, signal);
      try {
        const res = await callServer(() => push(job), {
          signal,
          idempotent: false,
          onWait: setWaiting,
        });
        result.added[job.kind] += res.added;
        result.notFound += res.notFound.length;
        if (signal.aborted) throw new CancelledError("Cancelled");
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
      report({ ...progress, done });
    }
  } catch (err) {
    if (err instanceof CancelledError) result.cancelled = true;
    else result.errors.push(toErrorInfo(err));
  }

  return result;
}
