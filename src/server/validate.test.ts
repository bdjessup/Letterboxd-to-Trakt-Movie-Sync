import { describe, expect, it } from "vitest";
import {
  MAX_PUSH_BATCH,
  MAX_RESOLVE_BATCH,
  ValidationError,
  validateFilmQueries,
  validateLibraryPage,
  validatePush,
  validateSearch,
} from "./validate";

describe("validatePush", () => {
  it("normalizes valid history items", () => {
    expect(
      validatePush({ kind: "history", items: [{ trakt: 5, watchedAt: "2024-01-01T12:00:00Z" }] }),
    ).toEqual({ kind: "history", items: [{ trakt: 5, watchedAt: "2024-01-01T12:00:00.000Z" }] });
  });

  it("drops unknown fields", () => {
    const result = validatePush({
      kind: "watchlist",
      items: [{ trakt: 1, extra: "nope" }],
      endpoint: "/oauth/revoke",
    });
    expect(result).toEqual({ kind: "watchlist", items: [{ trakt: 1 }] });
  });

  it.each([
    ["unknown kind", { kind: "collection", items: [{ trakt: 1 }] }],
    ["empty batch", { kind: "watchlist", items: [] }],
    ["oversized batch", { kind: "watchlist", items: Array(MAX_PUSH_BATCH + 1).fill({ trakt: 1 }) }],
    ["bad id", { kind: "watchlist", items: [{ trakt: -1 }] }],
    ["fractional id", { kind: "watchlist", items: [{ trakt: 1.5 }] }],
    ["rating out of range", { kind: "ratings", items: [{ trakt: 1, rating: 11 }] }],
    ["future play", { kind: "history", items: [{ trakt: 1, watchedAt: "2999-01-01T00:00:00Z" }] }],
    ["garbage date", { kind: "history", items: [{ trakt: 1, watchedAt: "yesterday" }] }],
    ["not an object", "history"],
  ])("rejects %s", (_, input) => {
    expect(() => validatePush(input)).toThrow(ValidationError);
  });
});

describe("other validators", () => {
  it("limits resolve batches", () => {
    const films = Array.from({ length: MAX_RESOLVE_BATCH }, (_, i) => ({
      title: `F${i}`,
      year: 2000,
    }));
    expect(validateFilmQueries({ films })).toHaveLength(MAX_RESOLVE_BATCH);
    expect(() => validateFilmQueries({ films: [...films, films[0]] })).toThrow(ValidationError);
    expect(() => validateFilmQueries({ films: [{ title: " ", year: 2000 }] })).toThrow();
    expect(validateFilmQueries({ films: [{ title: " Heat ", year: null }] })).toEqual([
      { title: "Heat", year: null },
    ]);
  });

  it("checks library page requests", () => {
    expect(validateLibraryPage({ kind: "ratings", page: 3 })).toEqual({ kind: "ratings", page: 3 });
    expect(() => validateLibraryPage({ kind: "lists", page: 1 })).toThrow();
    expect(() => validateLibraryPage({ kind: "history", page: 0 })).toThrow();
  });

  it("checks searches", () => {
    expect(validateSearch({ query: "Heat", year: 1995 })).toEqual({ query: "Heat", year: 1995 });
    expect(() => validateSearch({ query: "Heat", year: "1995" })).toThrow();
    expect(() => validateSearch({ query: "x".repeat(301) })).toThrow();
  });
});
