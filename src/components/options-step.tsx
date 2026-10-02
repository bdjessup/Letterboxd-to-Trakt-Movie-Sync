import { useMemo } from "react";
import type { SyncEngine } from "@/hooks/use-sync-engine";
import { formatDuration, plural } from "@/lib/format";
import { filmsToResolve } from "@/lib/plan";
import { summarizeImport } from "@/lib/summary";
import { ArrowRightIcon, FilmIcon } from "./icons";
import { Button, Card, Switch } from "./ui";

/** Rough cost of matching one film (most need one search, some two), at three per second. */
const MS_PER_FILM = 450;

export function OptionsStep({ engine }: { engine: SyncEngine }) {
  const { imported, options, resolutions } = engine;
  const { updateOptions, analyze, startOver } = engine.actions;

  const summary = useMemo(() => (imported ? summarizeImport(imported) : null), [imported]);
  const unmatched = useMemo(
    () =>
      imported ? filmsToResolve(imported, options).filter((f) => !resolutions[f.key]).length : 0,
    [imported, options, resolutions],
  );

  if (!imported || !summary) return null;
  const nothingChosen = !options.history && !options.ratings && !options.watchlist;

  return (
    <Card aria-labelledby="options-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="options-title" className="text-xl font-semibold tracking-tight">
            Choose what to sync
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-3">
            <FilmIcon className="size-4" />
            <span className="truncate">{imported.sourceName}</span> ·{" "}
            {plural(summary.films, "film")}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={startOver}>
          Use a different file
        </Button>
      </div>

      <div className="mt-4 divide-y divide-line">
        <Switch
          checked={options.history}
          onChange={(history) => updateOptions({ history })}
          disabled={summary.diaryEntries === 0 && summary.undated === 0}
          label="Watch history"
          description={
            summary.diaryEntries > 0
              ? `${plural(summary.diaryEntries, "diary entry", "diary entries")}${
                  summary.rewatches ? ` (${plural(summary.rewatches, "rewatch", "rewatches")})` : ""
                } become plays on the dates you logged.`
              : "No diary entries in this export."
          }
        />
        {options.history && summary.undated > 0 && (
          <div className="pl-4">
            <Switch
              checked={options.undated}
              onChange={(undated) => updateOptions({ undated })}
              label="Also add films without a diary date"
              description={`${plural(summary.undated, "film is", "films are")} marked watched with no diary entry. They'll be dated to when you marked them on Letterboxd.`}
            />
          </div>
        )}
        <Switch
          checked={options.ratings}
          onChange={(ratings) => updateOptions({ ratings })}
          disabled={summary.ratings === 0}
          label="Ratings"
          description={
            summary.ratings > 0
              ? `${plural(summary.ratings, "rating")}, converted from stars to Trakt's 1–10 scale.`
              : "No ratings in this export."
          }
        />
        <Switch
          checked={options.watchlist}
          onChange={(watchlist) => updateOptions({ watchlist })}
          disabled={summary.watchlist === 0}
          label="Watchlist"
          description={
            summary.watchlist > 0
              ? `${plural(summary.watchlist, "film")} added to your Trakt watchlist.`
              : "No watchlist in this export."
          }
        />
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-3">
          {unmatched > 0
            ? `Matching ${plural(unmatched, "film")} on Trakt takes ${formatDuration(unmatched * MS_PER_FILM)}. Nothing is changed until you confirm.`
            : "Nothing is changed on Trakt until you confirm."}
        </p>
        <Button size="lg" onClick={analyze} disabled={nothingChosen} className="shrink-0">
          Check against Trakt <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </Card>
  );
}
