import type { HistoryItem, LibraryKind, PushRequest, RatingItem, WatchlistItem } from "@/lib/types";

/** Most films a single resolve call accepts (keeps each Worker invocation well under its subrequest limit). */
export const MAX_RESOLVE_BATCH = 8;
/** Most items per write to Trakt. */
export const MAX_PUSH_BATCH = 100;

export class ValidationError extends Error {
  override name = "ValidationError";
}

function fail(message: string): never {
  throw new ValidationError(message);
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("Expected an object");
  return value as Record<string, unknown>;
}

function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    fail(`Expected 1–${max} items`);
  }
  return value;
}

function traktId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    fail("Invalid Trakt id");
  return value;
}

function title(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 300) fail("Invalid title");
  return value.trim();
}

function year(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1800 || value > 3000) {
    fail("Invalid year");
  }
  return value;
}

const EARLIEST = Date.UTC(1870, 0, 1);

function timestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 40) fail("Invalid timestamp");
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || ms < EARLIEST || ms > Date.now() + 36 * 3600 * 1000) {
    fail("Timestamp out of range");
  }
  return new Date(ms).toISOString();
}

export function validateFilmQueries(input: unknown): { title: string; year: number | null }[] {
  const { films } = object(input);
  return array(films, MAX_RESOLVE_BATCH).map((f) => {
    const o = object(f);
    return { title: title(o.title), year: year(o.year) };
  });
}

export function validateSearch(input: unknown): { query: string; year: number | null } {
  const o = object(input);
  return { query: title(o.query), year: year(o.year) };
}

const LIBRARY_KINDS: LibraryKind[] = ["history", "ratings", "watchlist"];

export function validateLibraryPage(input: unknown): { kind: LibraryKind; page: number } {
  const o = object(input);
  const kind = o.kind as LibraryKind;
  if (!LIBRARY_KINDS.includes(kind)) fail("Invalid library kind");
  const page = o.page;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > 2000)
    fail("Invalid page");
  return { kind, page };
}

export function validatePush(input: unknown): PushRequest {
  const o = object(input);
  switch (o.kind) {
    case "history":
      return {
        kind: "history",
        items: array(o.items, MAX_PUSH_BATCH).map((raw): HistoryItem => {
          const i = object(raw);
          return { trakt: traktId(i.trakt), watchedAt: timestamp(i.watchedAt) };
        }),
      };
    case "ratings":
      return {
        kind: "ratings",
        items: array(o.items, MAX_PUSH_BATCH).map((raw): RatingItem => {
          const i = object(raw);
          const rating = i.rating;
          if (
            typeof rating !== "number" ||
            !Number.isInteger(rating) ||
            rating < 1 ||
            rating > 10
          ) {
            fail("Rating must be 1–10");
          }
          return {
            trakt: traktId(i.trakt),
            rating,
            ...(i.ratedAt === undefined ? {} : { ratedAt: timestamp(i.ratedAt) }),
          };
        }),
      };
    case "watchlist":
      return {
        kind: "watchlist",
        items: array(o.items, MAX_PUSH_BATCH).map(
          (raw): WatchlistItem => ({ trakt: traktId(object(raw).trakt) }),
        ),
      };
    default:
      fail("Invalid push kind");
  }
}
