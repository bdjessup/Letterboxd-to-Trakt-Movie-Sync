import { localNoonToIso, today, toLocalDate, toUtcDate } from "./dates";
import { toTraktRating } from "./matching";
import type {
  DiaryEntry,
  Film,
  HistoryItem,
  LetterboxdImport,
  RatingItem,
  Resolution,
  TraktLibrary,
  WatchlistItem,
} from "./types";

export interface PlanOptions {
  /** Add diary entries to Trakt watch history. */
  history: boolean;
  /** Also add films marked watched on Letterboxd without a diary entry, dated when they were marked. */
  undated: boolean;
  ratings: boolean;
  watchlist: boolean;
  /** Don't add any plays for films that already have at least one play on Trakt. */
  skipWatchedFilms: boolean;
  /** Replace Trakt ratings that differ from Letterboxd. */
  overwriteRatings: boolean;
}

export const DEFAULT_OPTIONS: PlanOptions = {
  history: true,
  undated: false,
  ratings: true,
  watchlist: true,
  skipWatchedFilms: false,
  overwriteRatings: false,
};

export interface PlannedPlay {
  /** Diary entry id, or null for an undated film. */
  diaryId: string | null;
  date: string;
  watchedAt: string;
  undated: boolean;
}

export type RatingStatus = "none" | "add" | "same" | "conflict" | "overwrite";
export type WatchlistStatus = "none" | "add" | "present" | "watched";
export type FilmStatus = "sync" | "synced" | "not_found" | "unresolved";

export interface FilmPlan {
  film: Film;
  resolution: Resolution | undefined;
  status: FilmStatus;
  /** A fuzzy match the user should confirm before it's synced. */
  needsReview: boolean;
  plays: PlannedPlay[];
  /** Diary entries (or the undated watch) already on Trakt. */
  playsOnTrakt: number;
  /** Diary entries for this film, for display. */
  diaryEntries: number;
  rating: { value: number; stars: number; ratedAt?: string; previous?: number } | null;
  ratingStatus: RatingStatus;
  watchlistStatus: WatchlistStatus;
}

export interface SyncPlan {
  films: FilmPlan[];
  counts: {
    toSync: number;
    review: number;
    notFound: number;
    upToDate: number;
    ratingConflicts: number;
  };
}

export type ReviewGroup = "to_sync" | "review" | "not_found" | "up_to_date";

export function reviewGroup(f: FilmPlan): ReviewGroup {
  if (f.status === "not_found" || f.status === "unresolved") return "not_found";
  if (f.needsReview) return "review";
  return f.status === "sync" ? "to_sync" : "up_to_date";
}

/** Whether a film's changes are included when nothing has been toggled by hand. */
export function selectedByDefault(f: FilmPlan): boolean {
  return f.status === "sync" && !f.needsReview;
}

/** Films that need a Trakt match for the chosen options. */
export function filmsToResolve(imp: LetterboxdImport, options: PlanOptions): Film[] {
  const keys = new Set<string>();
  if (options.history) {
    for (const d of imp.diary) keys.add(d.filmKey);
    if (options.undated) for (const k of Object.keys(imp.watched)) keys.add(k);
  }
  if (options.ratings) for (const k of Object.keys(imp.ratings)) keys.add(k);
  if (options.watchlist) for (const k of Object.keys(imp.watchlist)) keys.add(k);
  return [...keys].flatMap((k) => (imp.films[k] ? [imp.films[k]] : []));
}

function groupDiary(diary: DiaryEntry[]): Map<string, DiaryEntry[]> {
  const byFilm = new Map<string, DiaryEntry[]>();
  const seenIds = new Set<string>();
  for (const entry of diary) {
    if (seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    const list = byFilm.get(entry.filmKey);
    if (list) list.push(entry);
    else byFilm.set(entry.filmKey, [entry]);
  }
  return byFilm;
}

const MINUTE_MS = 60_000;

function historyState(plays: string[], timeZone: string) {
  return {
    available: plays.map((iso) => ({
      local: toLocalDate(iso, timeZone),
      legacyDate: Date.parse(iso) % 86_400_000 === 0 ? toUtcDate(iso) : null,
      used: false,
    })),
    occupied: new Set(plays.map((iso) => Math.floor(Date.parse(iso) / MINUTE_MS) * MINUTE_MS)),
  };
}

/** Trakt deduplicates plays by minute. Prefer noon, capped at now for today's entries. */
function reservePlayTime(date: string, timeZone: string, occupied: Set<number>): string {
  const latest = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
  const noon = Math.floor(Date.parse(localNoonToIso(date, timeZone)) / MINUTE_MS) * MINUTE_MS;
  const preferred = Math.min(noon, latest);
  let minute = preferred;
  while (occupied.has(minute)) minute += MINUTE_MS;
  if (minute > latest || toLocalDate(new Date(minute).toISOString(), timeZone) !== date) {
    minute = preferred - MINUTE_MS;
    while (occupied.has(minute)) minute -= MINUTE_MS;
  }
  const iso = new Date(minute).toISOString();
  if (toLocalDate(iso, timeZone) !== date) {
    throw new Error(`Trakt has no free minute for another viewing on ${date}.`);
  }
  occupied.add(minute);
  return iso;
}

/**
 * Work out what to send to Trakt.
 *
 * A diary entry counts as already on Trakt when the film has an unused play on the
 * same calendar date in the user's time zone. Plays at UTC midnight also match their
 * UTC date for compatibility with older app versions. Each play covers one entry, so
 * two viewings on one day need two plays. Running the sync again never duplicates.
 */
export function buildPlan(
  imp: LetterboxdImport,
  resolutions: Record<string, Resolution>,
  library: TraktLibrary,
  options: PlanOptions,
  timeZone: string,
): SyncPlan {
  const diaryByFilm = groupDiary(imp.diary);
  const latestDate = today(timeZone);
  const films: FilmPlan[] = [];
  const histories = new Map<number, ReturnType<typeof historyState>>();

  for (const film of filmsToResolve(imp, options)) {
    const resolution = resolutions[film.key];
    const entries = options.history ? (diaryByFilm.get(film.key) ?? []) : [];
    const plan: FilmPlan = {
      film,
      resolution,
      status: "unresolved",
      needsReview: false,
      plays: [],
      playsOnTrakt: 0,
      diaryEntries: entries.length,
      rating: null,
      ratingStatus: "none",
      watchlistStatus: "none",
    };
    films.push(plan);

    if (!resolution) continue;
    if (resolution.status === "not_found") {
      plan.status = "not_found";
      continue;
    }

    const traktId = resolution.movie.trakt;
    plan.needsReview = resolution.confidence === "likely";
    const existingPlays = library.plays[traktId] ?? [];

    // Watch history
    if (options.history) {
      let history = histories.get(traktId);
      if (!history) {
        history = historyState(existingPlays, timeZone);
        histories.set(traktId, history);
      }
      const { available, occupied } = history;
      for (const entry of entries) {
        if (options.skipWatchedFilms && existingPlays.length > 0) {
          plan.playsOnTrakt++;
          continue;
        }
        const match =
          available.find((p) => !p.used && p.local === entry.watchedDate) ??
          available.find((p) => !p.used && p.legacyDate === entry.watchedDate);
        if (match) {
          match.used = true;
          plan.playsOnTrakt++;
        } else if (entry.watchedDate <= latestDate) {
          plan.plays.push({
            diaryId: entry.id,
            date: entry.watchedDate,
            watchedAt: reservePlayTime(entry.watchedDate, timeZone, occupied),
            undated: false,
          });
        }
      }

      const undated = imp.watched[film.key];
      if (options.undated && entries.length === 0 && undated) {
        if (occupied.size > 0) plan.playsOnTrakt++;
        else if (undated.date && undated.date <= latestDate) {
          plan.plays.push({
            diaryId: null,
            date: undated.date,
            watchedAt: reservePlayTime(undated.date, timeZone, occupied),
            undated: true,
          });
        }
      }
    }

    // Rating
    const lbRating = options.ratings ? imp.ratings[film.key] : undefined;
    if (lbRating) {
      const value = toTraktRating(lbRating.rating);
      const date = lbRating.date ?? entries.at(-1)?.watchedDate ?? null;
      const ratedAt = date && date <= latestDate ? localNoonToIso(date, timeZone) : undefined;
      const previous = library.ratings[traktId];
      plan.rating = { value, stars: lbRating.rating, ratedAt, previous };
      if (previous === value) plan.ratingStatus = "same";
      else if (previous == null) plan.ratingStatus = "add";
      else plan.ratingStatus = options.overwriteRatings ? "overwrite" : "conflict";
    }

    // Watchlist
    if (options.watchlist && imp.watchlist[film.key]) {
      if (library.watchlist[traktId]) plan.watchlistStatus = "present";
      else if (existingPlays.length > 0) plan.watchlistStatus = "watched";
      else plan.watchlistStatus = "add";
    }

    const hasChanges =
      plan.plays.length > 0 ||
      plan.ratingStatus === "add" ||
      plan.ratingStatus === "overwrite" ||
      plan.watchlistStatus === "add";
    plan.status = hasChanges ? "sync" : "synced";
  }

  const counts = { toSync: 0, review: 0, notFound: 0, upToDate: 0, ratingConflicts: 0 };
  for (const f of films) {
    const group = reviewGroup(f);
    if (group === "to_sync") counts.toSync++;
    else if (group === "review") counts.review++;
    else if (group === "not_found") counts.notFound++;
    else counts.upToDate++;
    if (f.ratingStatus === "conflict") counts.ratingConflicts++;
  }

  films.sort((a, b) => a.film.title.localeCompare(b.film.title));
  return { films, counts };
}

export interface SyncRequests {
  history: HistoryItem[];
  ratings: RatingItem[];
  watchlist: WatchlistItem[];
}

/** Turn the selected films' changes into Trakt requests, dropping duplicates. */
export function buildRequests(plan: SyncPlan, isSelected: (f: FilmPlan) => boolean): SyncRequests {
  const history = new Map<string, HistoryItem>();
  const ratings = new Map<number, RatingItem>();
  const watchlist = new Map<number, WatchlistItem>();

  for (const f of plan.films) {
    if (f.status !== "sync" || f.resolution?.status !== "matched" || !isSelected(f)) continue;
    const trakt = f.resolution.movie.trakt;
    for (const play of f.plays) {
      const entry = play.diaryId === null ? `undated:${play.watchedAt}` : `diary:${play.diaryId}`;
      history.set(`${trakt}@${entry}`, { trakt, watchedAt: play.watchedAt });
    }
    if (f.rating && (f.ratingStatus === "add" || f.ratingStatus === "overwrite")) {
      const prev = ratings.get(trakt);
      if (!prev || (f.rating.ratedAt ?? "") > (prev.ratedAt ?? "")) {
        ratings.set(trakt, { trakt, rating: f.rating.value, ratedAt: f.rating.ratedAt });
      }
    }
    if (f.watchlistStatus === "add") watchlist.set(trakt, { trakt });
  }

  return {
    history: [...history.values()],
    ratings: [...ratings.values()],
    watchlist: [...watchlist.values()],
  };
}

export function countRequests(r: SyncRequests): number {
  return r.history.length + r.ratings.length + r.watchlist.length;
}
