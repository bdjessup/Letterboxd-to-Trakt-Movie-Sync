import { CancelledError } from "./client-api";
import type { AppErrorInfo } from "./types";
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

export function assertActive(signal: AbortSignal) {
  if (signal.aborted) throw new CancelledError("Cancelled");
}
