import { useState } from "react";
import type { SyncEngine } from "@/hooks/use-sync-engine";

export function SiteFooter({ engine }: { engine: SyncEngine }) {
  const [confirming, setConfirming] = useState(false);
  const hasSavedData =
    engine.hydrated && (engine.imported !== null || Object.keys(engine.resolutions).length > 0);

  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="font-medium text-ink-2">Less logging. More watching.</p>
          <p className="mt-1 text-xs">
            An independent tool. Not affiliated with Letterboxd or Trakt.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {hasSavedData &&
            (confirming ? (
              <span className="flex max-w-sm flex-wrap items-center gap-x-3">
                <span className="w-full text-ink-2">
                  Remove this browser's export and saved matches?
                </span>
                <button
                  type="button"
                  className="min-h-11 rounded-lg font-medium text-bad hover:underline"
                  onClick={async () => {
                    await engine.actions.forgetEverything();
                    setConfirming(false);
                  }}
                >
                  Remove
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-lg font-medium hover:text-ink"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="min-h-11 rounded-lg hover:text-ink hover:underline"
                onClick={() => setConfirming(true)}
              >
                Clear saved data
              </button>
            ))}
          <a
            href="https://github.com/bdjessup/letterboxd-to-trakt-movie-sync"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-lg hover:text-ink hover:underline"
          >
            Source on GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
