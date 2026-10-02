import { useEffect, useState } from "react";
import type { SyncEngine } from "@/hooks/use-sync-engine";
import { capitalize, formatDuration, formatNumber } from "@/lib/format";
import { Button, Card, ProgressBar, Spinner } from "./ui";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function ProgressStep({ engine }: { engine: SyncEngine }) {
  const { progress, stage } = engine;
  const now = useNow(Boolean(progress));
  if (!progress) return null;

  const { done, total, startedAt, waitingUntil, label } = progress;
  const elapsed = now - startedAt;
  const remaining = done >= 2 && elapsed > 3000 ? ((total - done) * elapsed) / done : null;
  const waitSeconds = waitingUntil ? Math.max(0, Math.ceil((waitingUntil - now) / 1000)) : 0;

  return (
    <Card aria-labelledby="progress-title" aria-busy="true">
      <div className="flex items-center gap-3">
        <Spinner className="size-5 text-brand-ink" />
        <h2 id="progress-title" className="text-xl font-semibold tracking-tight">
          {label}…
        </h2>
      </div>

      <div className="mt-6">
        <ProgressBar value={done} max={total} label={label} />
        <div className="mt-2 flex justify-between gap-4 text-sm text-ink-3" aria-live="polite">
          <span className="tabular-nums">
            {formatNumber(done)} of {formatNumber(total)}
          </span>
          <span>
            {waitSeconds > 0
              ? `Trakt asked us to pause · resuming in ${waitSeconds}s`
              : remaining !== null
                ? `${capitalize(formatDuration(remaining))} left`
                : "Estimating…"}
          </span>
        </div>
      </div>

      <p className="mt-6 text-sm text-ink-3">
        {stage === "analyzing"
          ? "Trakt limits how fast apps can search, so large libraries take a few minutes. Matches are saved in this browser, so stopping now doesn't lose progress."
          : "Keep this tab open until it finishes. Changes are sent in batches of up to 100."}
      </p>

      <div className="mt-5">
        <Button variant="secondary" onClick={engine.actions.cancel}>
          {stage === "syncing" ? "Stop syncing" : "Stop"}
        </Button>
      </div>
    </Card>
  );
}
