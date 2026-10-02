import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SyncEngine } from "@/hooks/use-sync-engine";
import { formatNumber, listJoin, plural } from "@/lib/format";
import { normalizeTitle } from "@/lib/matching";
import { countRequests, type FilmPlan, type ReviewGroup, reviewGroup } from "@/lib/plan";
import type { TraktMovieRef } from "@/lib/types";
import { FilmRow } from "./film-row";
import { ArrowLeftIcon, ArrowRightIcon, SearchIcon } from "./icons";
import { MatchDialog } from "./match-dialog";
import { Alert, Button, Card, cx, Switch } from "./ui";

const TABS: { id: ReviewGroup; label: string; empty: string }[] = [
  { id: "to_sync", label: "To sync", empty: "Nothing new to send. Trakt is up to date." },
  { id: "review", label: "Check matches", empty: "Every film matched exactly." },
  { id: "not_found", label: "Not found", empty: "Every film was found on Trakt." },
  { id: "up_to_date", label: "Up to date", empty: "No films are fully synced yet." },
];

function downloadCsv(filename: string, rows: string[][]) {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = rows.map((r) => r.map(quote).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Stat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface-2 p-3 ring-1 ring-line ring-inset sm:p-4">
      <p className="text-xs text-ink-3 sm:text-sm">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
        {formatNumber(value)}
      </p>
      {detail && <p className="mt-0.5 text-xs text-pretty text-ink-3">{detail}</p>}
    </div>
  );
}

export function ReviewStep({ engine }: { engine: SyncEngine }) {
  const { plan, requests, options, isSelected } = engine;
  const { setFilmSelected, setManualMatch, updateOptions, sync, backToOptions } = engine.actions;

  const groups = useMemo(() => {
    const g: Record<ReviewGroup, FilmPlan[]> = {
      to_sync: [],
      review: [],
      not_found: [],
      up_to_date: [],
    };
    for (const f of plan?.films ?? []) g[reviewGroup(f)].push(f);
    return g;
  }, [plan]);

  const [tab, setTab] = useState<ReviewGroup>(
    () => TABS.find((t) => groups[t.id].length > 0)?.id ?? "to_sync",
  );
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [matching, setMatching] = useState<FilmPlan | null>(null);

  const visible = useMemo(() => {
    const q = normalizeTitle(deferredQuery);
    const films = groups[tab];
    return q ? films.filter((f) => normalizeTitle(f.film.title).includes(q)) : films;
  }, [groups, tab, deferredQuery]);

  const stats = useMemo(() => {
    let playsOnTrakt = 0;
    let ratingsSame = 0;
    let watchlistSkipped = 0;
    for (const f of plan?.films ?? []) {
      playsOnTrakt += f.playsOnTrakt;
      if (f.ratingStatus === "same") ratingsSame++;
      if (f.watchlistStatus === "present" || f.watchlistStatus === "watched") watchlistSkipped++;
    }
    return { playsOnTrakt, ratingsSame, watchlistSkipped };
  }, [plan]);

  const onToggle = useCallback(
    (key: string, selected: boolean) => setFilmSelected([key], selected),
    [setFilmSelected],
  );

  const onChoose = (movie: TraktMovieRef | null) => {
    if (matching) setManualMatch(matching.film.key, movie);
    setMatching(null);
  };

  if (!plan || !requests) return null;

  const total = countRequests(requests);
  const selectable = visible.filter((f) => f.status === "sync");
  const allSelected = selectable.length > 0 && selectable.every(isSelected);
  const conflicts = plan.counts.ratingConflicts;

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    if (next) {
      setTab(next.id);
      document.getElementById(`tab-${next.id}`)?.focus();
    }
  };

  const summaryParts = [
    requests.history.length && plural(requests.history.length, "play"),
    requests.ratings.length && plural(requests.ratings.length, "rating"),
    requests.watchlist.length && `${formatNumber(requests.watchlist.length)} to watchlist`,
  ].filter((x): x is string => Boolean(x));

  return (
    <div className="space-y-4">
      <Card aria-labelledby="review-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="review-title" className="text-xl font-semibold tracking-tight">
              Review changes
            </h2>
            <p className="mt-1 text-sm text-ink-3">
              Nothing has been sent yet. Untick anything you'd rather leave out.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={backToOptions}>
            <ArrowLeftIcon className="size-4" /> Back
          </Button>
        </div>

        <div className="mt-5 grid auto-cols-fr grid-flow-col gap-2 sm:gap-3">
          {options.history && (
            <Stat
              label="Plays to add"
              value={requests.history.length}
              detail={`${formatNumber(stats.playsOnTrakt)} already on Trakt`}
            />
          )}
          {options.ratings && (
            <Stat
              label="Ratings to add"
              value={requests.ratings.length}
              detail={`${formatNumber(stats.ratingsSame)} already match${conflicts ? ` · ${formatNumber(conflicts)} differ` : ""}`}
            />
          )}
          {options.watchlist && (
            <Stat
              label="Watchlist to add"
              value={requests.watchlist.length}
              detail={`${formatNumber(stats.watchlistSkipped)} already there or watched`}
            />
          )}
        </div>

        <div className="mt-4 divide-y divide-line">
          {options.ratings && (conflicts > 0 || options.overwriteRatings) && (
            <Switch
              checked={options.overwriteRatings}
              onChange={(overwriteRatings) => updateOptions({ overwriteRatings })}
              label="Replace different Trakt ratings"
              description={`${plural(conflicts, "film has", "films have")} a different rating on Trakt. By default, Trakt's rating is kept.`}
            />
          )}
          {options.history && (
            <Switch
              checked={options.skipWatchedFilms}
              onChange={(skipWatchedFilms) => updateOptions({ skipWatchedFilms })}
              label="Skip films already watched on Trakt"
              description="Only add plays for films with no plays on Trakt yet. Useful if you logged them on Trakt with other dates."
            />
          )}
        </div>

        {groups.review.length > 0 && (
          <div className="mt-4">
            <Alert
              tone="warn"
              title={`${plural(groups.review.length, "film needs", "films need")} a quick check`}
            >
              These matched a Trakt movie with a slightly different title or year. They're left out
              until you tick them in “Check matches”.
            </Alert>
          </div>
        )}
      </Card>

      <Card className="!p-0" aria-label="Films">
        <div
          role="tablist"
          aria-label="Filter films"
          onKeyDown={onTabKey}
          className="flex gap-1 overflow-x-auto border-b border-line p-2 [scrollbar-width:none]"
        >
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="film-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(t.id)}
                className={cx(
                  "flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors",
                  active ? "bg-surface-3 text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink",
                )}
              >
                {t.label}
                <span
                  className={cx(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    t.id === "review" && groups.review.length > 0
                      ? "bg-warn-soft text-warn"
                      : t.id === "not_found" && groups.not_found.length > 0
                        ? "bg-bad-soft text-bad"
                        : "bg-surface-2 text-ink-3",
                  )}
                >
                  {formatNumber(groups[t.id].length)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
          <label className="relative min-w-0 flex-1 basis-48">
            <span className="sr-only">Search films</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search films"
              className="h-10 w-full rounded-xl bg-surface-2 pr-3 pl-9 text-sm ring-1 ring-line ring-inset focus:ring-2 focus:ring-brand focus:outline-none"
            />
          </label>
          {selectable.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setFilmSelected(
                  selectable.map((f) => f.film.key),
                  !allSelected,
                )
              }
            >
              {allSelected ? "Select none" : `Select all ${formatNumber(selectable.length)}`}
            </Button>
          )}
          {tab === "not_found" && visible.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadCsv("letterboxd-not-on-trakt.csv", [
                  ["Title", "Year"],
                  ...visible.map((f) => [f.film.title, f.film.year ? String(f.film.year) : ""]),
                ])
              }
            >
              Download list
            </Button>
          )}
        </div>

        <div id="film-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {visible.length === 0 ? (
            <p className="px-5 py-12 text-center text-ink-3">
              {query ? "No films match your search." : TABS.find((t) => t.id === tab)?.empty}
            </p>
          ) : (
            <VirtualFilmList
              films={visible}
              isSelected={isSelected}
              onToggle={onToggle}
              onMatch={setMatching}
            />
          )}
        </div>
      </Card>

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-bg/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:mx-0 sm:mb-4 sm:rounded-2xl sm:border sm:bg-surface/85 sm:px-4 sm:pb-3 sm:shadow-card">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-ink-2" aria-live="polite">
            {total > 0 ? (
              <>
                <span className="font-medium text-ink">Ready:</span> {listJoin(summaryParts)}
              </>
            ) : (
              "Nothing selected to sync."
            )}
          </p>
          <Button size="lg" onClick={sync} disabled={total === 0} className="shrink-0">
            Sync to Trakt <ArrowRightIcon className="size-4" />
          </Button>
        </div>
      </div>

      <MatchDialog film={matching} onChoose={onChoose} onClose={() => setMatching(null)} />
    </div>
  );
}

function VirtualFilmList({
  films,
  isSelected,
  onToggle,
  onMatch,
}: {
  films: FilmPlan[];
  isSelected: (f: FilmPlan) => boolean;
  onToggle: (key: string, selected: boolean) => void;
  onMatch: (f: FilmPlan) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setScrollMargin((prev) => (Math.abs(prev - top) < 1 ? prev : top));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: films.length,
    estimateSize: () => 84,
    overscan: 8,
    scrollMargin,
    getItemKey: (i) => films[i]?.film.key ?? i,
  });

  return (
    <ul ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const f = films[item.index];
        if (!f) return null;
        return (
          <li
            key={item.key}
            aria-setsize={films.length}
            aria-posinset={item.index + 1}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full border-b border-line last:border-b-0"
            style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            <FilmRow f={f} selected={isSelected(f)} onToggle={onToggle} onMatch={onMatch} />
          </li>
        );
      })}
    </ul>
  );
}
