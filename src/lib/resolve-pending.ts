import type { ResolveBatchResult } from "@/server/resolve";
import { CancelledError, callServer } from "./client-api";
import type { Film, Resolution, Result } from "./types";

interface ResolvePendingOptions {
  films: Film[];
  signal: AbortSignal;
  resolve: (films: Film[]) => Promise<Result<ResolveBatchResult>>;
  onResolved: (resolutions: Record<string, Resolution>) => void;
  onWait?: (until: number | null) => void;
}

const invalidReply = (): Result<void> => ({
  ok: false,
  error: {
    code: "bad_request",
    message: "Received an invalid matching response. Please try again.",
  },
});

/** Checkpoint completed films before retrying only the unfinished positions in one batch. */
export async function resolvePendingFilms({
  films,
  signal,
  resolve,
  onResolved,
  onWait,
}: ResolvePendingOptions): Promise<void> {
  if (signal.aborted) throw new CancelledError("Cancelled");
  if (films.length === 0) return;
  let pending = [...films];

  await callServer(
    async (): Promise<Result<void>> => {
      const result = await resolve(pending);
      if (signal.aborted) throw new CancelledError("Cancelled");
      if (!result.ok) return result;

      const batch = result.data;
      if (batch.resolutions.length !== pending.length) return invalidReply();
      const completed: Record<string, Resolution> = {};
      const unfinished: Film[] = [];
      for (const [index, film] of pending.entries()) {
        const resolution = batch.resolutions[index];
        if (resolution) completed[film.key] = resolution;
        else unfinished.push(film);
      }
      if (
        (batch.status === "complete" && unfinished.length > 0) ||
        (batch.status === "partial" && unfinished.length === 0)
      ) {
        return invalidReply();
      }

      pending = unfinished;
      if (Object.keys(completed).length > 0) onResolved(completed);
      return batch.status === "partial"
        ? { ok: false, error: batch.error }
        : { ok: true, data: undefined };
    },
    { signal, idempotent: true, onWait },
  );
}
