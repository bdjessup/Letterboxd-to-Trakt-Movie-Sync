import { useState } from "react";
import type { SyncEngine } from "@/hooks/use-sync-engine";

export function SiteFooter({ engine }: { engine: SyncEngine }) {
  const [confirming, setConfirming] = useState(false);
  const hasSavedData =
    engine.hydrated && (engine.imported !== null || Object.keys(engine.resolutions).length > 0);

  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-8 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Not affiliated with Letterboxd or Trakt.</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {hasSavedData &&
            (confirming ? (
              <span className="flex items-center gap-2">
                Remove your export and saved matches from this browser?
                <button
                  type="button"
                  className="font-medium text-bad hover:underline"
                  onClick={async () => {
                    await engine.actions.forgetEverything();
                    setConfirming(false);
                  }}
                >
                  Remove
                </button>
                <button
                  type="button"
                  className="font-medium hover:text-ink"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="hover:text-ink hover:underline"
                onClick={() => setConfirming(true)}
              >
                Clear saved data
              </button>
            ))}
          <a
            href="https://github.com/bdjessup/letterboxd-to-trakt-movie-sync"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink hover:underline"
          >
            Source on GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
