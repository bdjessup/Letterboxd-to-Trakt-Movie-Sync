/** A film as Letterboxd describes it. Films are identified across export files by title + year. */
export interface Film {
  key: string;
  title: string;
  year: number | null;
}

/** One diary log. A film logged three times has three entries. */
export interface DiaryEntry {
  id: string;
  filmKey: string;
  /** Calendar date the film was watched (YYYY-MM-DD, no time zone). */
  watchedDate: string;
  /** Letterboxd stars, 0.5–5. */
  rating: number | null;
  rewatch: boolean;
}

export interface DatedFilm {
  /** YYYY-MM-DD */
  date: string | null;
}

export interface FilmRating extends DatedFilm {
  rating: number;
}

export interface LetterboxdImport {
  sourceName: string;
  importedAt: string;
  films: Record<string, Film>;
  diary: DiaryEntry[];
  /** Current rating per film (ratings.csv, falling back to the latest rated diary entry). */
  ratings: Record<string, FilmRating>;
  watchlist: Record<string, DatedFilm>;
  /** Films marked as watched (watched.csv). Most have diary entries; some don't. */
  watched: Record<string, DatedFilm>;
}

export interface TraktMovieRef {
  trakt: number;
  slug: string;
  title: string;
  year: number | null;
  imdb?: string | null;
  tmdb?: number | null;
}

export type MatchConfidence = "exact" | "likely" | "manual";

export type Resolution =
  | { status: "matched"; movie: TraktMovieRef; confidence: MatchConfidence }
  | { status: "not_found" };

export interface TraktLibrary {
  /** Trakt id → every watched_at timestamp (ISO, UTC) in the user's history. */
  plays: Record<number, string[]>;
  /** Trakt id → rating 1–10. */
  ratings: Record<number, number>;
  watchlist: Record<number, true>;
}

export interface Viewer {
  username: string;
  slug: string;
  name: string;
  avatarUrl: string | null;
  timeZone: string | null;
  vip: boolean;
}

export type LibraryKind = "history" | "ratings" | "watchlist";

export type ActionKind = "history" | "rating" | "watchlist";

export interface HistoryItem {
  trakt: number;
  watchedAt: string;
}

export interface RatingItem {
  trakt: number;
  rating: number;
  ratedAt?: string;
}

export interface WatchlistItem {
  trakt: number;
}

export type PushRequest =
  | { kind: "history"; items: HistoryItem[] }
  | { kind: "ratings"; items: RatingItem[] }
  | { kind: "watchlist"; items: WatchlistItem[] };

export interface PushResult {
  added: number;
  existing: number;
  notFound: number[];
}

export type ErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "account_limit"
  | "unavailable"
  | "bad_request"
  | "network";

export interface AppErrorInfo {
  code: ErrorCode;
  message: string;
  /** Seconds to wait before retrying, when the server said so. */
  retryAfter?: number;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppErrorInfo };
