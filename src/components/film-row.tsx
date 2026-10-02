import { memo } from "react";
import { formatDate, plural, stars, traktMovieUrl } from "@/lib/format";
import type { FilmPlan } from "@/lib/plan";
import { BookmarkIcon, ExternalIcon, RepeatIcon, StarIcon } from "./icons";
import { Badge, Button } from "./ui";

function Badges({ f }: { f: FilmPlan }) {
  const badges = [];

  if (f.status === "not_found")
    badges.push(
      <Badge key="nf" tone="bad">
        Not found on Trakt
      </Badge>,
    );
  if (f.status === "unresolved") badges.push(<Badge key="un">Not checked yet</Badge>);
  if (f.needsReview)
    badges.push(
      <Badge key="rv" tone="warn">
        Check this match
      </Badge>,
    );

  if (f.plays.length > 0) {
    const undated = f.plays.some((p) => p.undated);
    badges.push(
      <Badge key="pl" tone="brand">
        <RepeatIcon className="size-3" />+{plural(f.plays.length, "play")}
        {undated ? " (undated)" : ""}
      </Badge>,
    );
  }
  if (f.playsOnTrakt > 0) {
    badges.push(<Badge key="pt">{plural(f.playsOnTrakt, "play")} already on Trakt</Badge>);
  }

  if (f.rating) {
    const { value, stars: lb, previous } = f.rating;
    if (f.ratingStatus === "add") {
      badges.push(
        <Badge key="ra" tone="good" title={`Letterboxd ${lb} stars → Trakt ${value}/10`}>
          <StarIcon className="size-3" />
          {stars(lb)} → {value}/10
        </Badge>,
      );
    } else if (f.ratingStatus === "overwrite") {
      badges.push(
        <Badge key="ro" tone="good">
          <StarIcon className="size-3" />
          Rating {previous} → {value}/10
        </Badge>,
      );
    } else if (f.ratingStatus === "conflict") {
      badges.push(
        <Badge key="rc" tone="warn" title={`Letterboxd says ${value}/10`}>
          Trakt rating differs ({previous} vs {value})
        </Badge>,
      );
    } else if (f.ratingStatus === "same") {
      badges.push(<Badge key="rs">Rating matches</Badge>);
    }
  }

  if (f.watchlistStatus === "add") {
    badges.push(
      <Badge key="wa" tone="info">
        <BookmarkIcon className="size-3" />+ Watchlist
      </Badge>,
    );
  } else if (f.watchlistStatus === "present") {
    badges.push(<Badge key="wp">On watchlist</Badge>);
  } else if (f.watchlistStatus === "watched") {
    badges.push(
      <Badge key="ww" title="Not added to your watchlist because Trakt shows it as watched">
        Watched on Trakt
      </Badge>,
    );
  }
  return <div className="mt-1.5 flex flex-wrap gap-1.5">{badges}</div>;
}

export const FilmRow = memo(function FilmRow({
  f,
  selected,
  onToggle,
  onMatch,
}: {
  f: FilmPlan;
  selected: boolean;
  onToggle: (key: string, selected: boolean) => void;
  onMatch: (f: FilmPlan) => void;
}) {
  const matched = f.resolution?.status === "matched" ? f.resolution : null;
  const selectable = f.status === "sync";
  const titleDiffers =
    matched &&
    (matched.movie.title.toLowerCase() !== f.film.title.toLowerCase() ||
      matched.movie.year !== f.film.year);
  const dates =
    f.plays.length > 0 && f.plays.length <= 3 ? f.plays.map((p) => formatDate(p.date)) : [];

  return (
    <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <div className="flex h-6 w-5 shrink-0 items-center">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onToggle(f.film.key, e.target.checked)}
            className="size-[18px] cursor-pointer rounded accent-brand"
            aria-label={`Sync ${f.film.title}`}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium leading-6">
          {f.film.title}
          {f.film.year && <span className="font-normal text-ink-3"> ({f.film.year})</span>}
        </p>
        {matched && (titleDiffers || matched.confidence !== "exact") && (
          <a
            href={traktMovieUrl(matched.movie.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-sm text-ink-3 hover:text-brand-ink"
          >
            <span className="truncate">
              Trakt: {matched.movie.title}
              {matched.movie.year ? ` (${matched.movie.year})` : ""}
            </span>
            <ExternalIcon className="size-3 shrink-0" />
          </a>
        )}
        <Badges f={f} />
        {dates.length > 0 && <p className="mt-1 text-xs text-ink-3">{dates.join(" · ")}</p>}
      </div>
      <Button
        variant={f.status === "not_found" || f.needsReview ? "secondary" : "ghost"}
        size="sm"
        onClick={() => onMatch(f)}
        className="shrink-0"
      >
        {matched ? "Change" : "Find"}
      </Button>
    </div>
  );
});
