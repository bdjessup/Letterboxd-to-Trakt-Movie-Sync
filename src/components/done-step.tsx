import { useEffect } from "react";
import type { SyncEngine } from "@/hooks/use-sync-engine";
import { formatNumber, listJoin, plural } from "@/lib/format";
import type { Viewer } from "@/lib/types";
import { CheckIcon, ExternalIcon, RefreshIcon } from "./icons";
import { Alert, Button, Card, LinkButton } from "./ui";

async function celebrate() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { default: confetti } = await import("canvas-confetti");
  const colors = ["#ff8000", "#00e054", "#40bcf4", "#9f42c6"];
  confetti({
    particleCount: 120,
    spread: 75,
    origin: { y: 0.65 },
    colors,
    disableForReducedMotion: true,
  });
}

export function DoneStep({ engine, viewer }: { engine: SyncEngine; viewer: Viewer }) {
  const { outcome } = engine;
  const { analyze, startOver } = engine.actions;
  const success = Boolean(outcome && !outcome.cancelled && outcome.errors.length === 0);

  useEffect(() => {
    if (success) void celebrate();
  }, [success]);

  if (!outcome) return null;
  const { added } = outcome;
  const parts = [
    added.history && plural(added.history, "play"),
    added.ratings && plural(added.ratings, "rating"),
    added.watchlist && `${plural(added.watchlist, "film")} on your watchlist`,
  ].filter((x): x is string => Boolean(x));
  const historyUrl = `https://trakt.tv/users/${encodeURIComponent(viewer.slug)}/history`;

  return (
    <Card aria-labelledby="done-title">
      <div className="flex flex-col items-center text-center">
        <span
          className={
            success
              ? "grid size-14 place-items-center rounded-full bg-good-soft text-good"
              : "grid size-14 place-items-center rounded-full bg-warn-soft text-warn"
          }
        >
          <CheckIcon className="size-7" strokeWidth={2.5} />
        </span>
        <h2 id="done-title" className="mt-4 text-2xl font-semibold tracking-tight">
          {outcome.cancelled ? "Sync stopped" : success ? "All done!" : "Finished with problems"}
        </h2>
        <p className="mt-2 max-w-md text-pretty text-ink-2">
          {parts.length > 0
            ? `Trakt now has ${listJoin(parts)} from your Letterboxd.`
            : "Nothing was added."}
          {outcome.cancelled && " Run the check again to pick up where you left off."}
        </p>
      </div>

      <div className="mt-6 space-y-3">
        {outcome.notFound > 0 && (
          <Alert tone="warn" title={`Trakt couldn't find ${plural(outcome.notFound, "item")}`}>
            Those films may have been removed or merged on Trakt.
          </Alert>
        )}
        {outcome.errors.map((e, i) => (
          <Alert
            // biome-ignore lint/suspicious/noArrayIndexKey: errors never reorder
            key={i}
            tone="bad"
            title={e.code === "account_limit" ? "Trakt account limit" : "Something went wrong"}
            action={
              e.code === "unauthorized" ? (
                <LinkButton href="/api/auth/login" size="sm">
                  Reconnect Trakt
                </LinkButton>
              ) : undefined
            }
          >
            {e.message}{" "}
            {e.code !== "account_limit" &&
              "Run the check again to see what made it. Nothing will be duplicated."}
          </Alert>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <LinkButton href={historyUrl} target="_blank" rel="noopener noreferrer">
          Open Trakt history <ExternalIcon className="size-4" />
        </LinkButton>
        <Button variant="secondary" onClick={analyze}>
          <RefreshIcon className="size-4" /> Check again
        </Button>
        <Button variant="ghost" onClick={startOver}>
          Start over
        </Button>
      </div>
      {success && outcome.attempted > 0 && (
        <p className="mt-4 text-center text-xs text-ink-3">
          {formatNumber(outcome.attempted)} changes sent. Running the check again should show
          everything up to date.
        </p>
      )}
    </Card>
  );
}
