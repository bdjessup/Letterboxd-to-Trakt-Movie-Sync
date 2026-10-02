import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildImport, extractZip, ImportError } from "./letterboxd";
import { summarizeImport } from "./summary";

const DIARY = `﻿Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2024-01-02,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/a1,4.5,,,2024-01-01
2024-02-10,Dune,2021,https://boxd.it/a2,4,,,2024-02-09
2024-03-01,Dune,2021,https://boxd.it/a3,5,Yes,,2024-03-01
2024-03-05,No Date Film,1999,https://boxd.it/a4,,,,
2024-03-06,,2000,https://boxd.it/a5,3,,,2024-03-06
`;

const RATINGS = `Date,Name,Year,Letterboxd URI,Rating
2024-03-01,Dune,2021,https://boxd.it/f1,4.5
2023-05-01,Heat,1995,https://boxd.it/f2,5
2023-05-02,Bad Rating,1995,https://boxd.it/f3,9
`;

const WATCHLIST = `Date,Name,Year,Letterboxd URI
2024-04-01,Past Lives,2023,https://boxd.it/f4
`;

const WATCHED = `Date,Name,Year,Letterboxd URI
2020-01-01,Heat,1995,https://boxd.it/f2
2024-02-10,Dune,2021,https://boxd.it/f5
`;

describe("buildImport", () => {
  const imp = buildImport(
    [
      { name: "diary.csv", text: DIARY },
      { name: "ratings.csv", text: RATINGS },
      { name: "watchlist.csv", text: WATCHLIST },
      { name: "watched.csv", text: WATCHED },
    ],
    "export.zip",
  );

  it("parses quoted titles and keeps every diary entry, including rewatches", () => {
    expect(imp.diary.map((d) => [d.filmKey, d.watchedDate, d.rewatch])).toEqual([
      ["crouching tiger hidden dragon|2000", "2024-01-01", false],
      ["dune|2021", "2024-02-09", false],
      ["dune|2021", "2024-03-01", true],
      // No "Watched Date": falls back to the logged date.
      ["no date film|1999", "2024-03-05", false],
    ]);
    expect(imp.films["crouching tiger hidden dragon|2000"]?.title).toBe(
      "Crouching Tiger, Hidden Dragon",
    );
  });

  it("uses diary URIs as stable entry ids", () => {
    expect(imp.diary[1]?.id).toBe("https://boxd.it/a2");
  });

  it("takes ratings from ratings.csv and drops invalid ones", () => {
    expect(imp.ratings["dune|2021"]).toEqual({ rating: 4.5, date: "2024-03-01" });
    expect(imp.ratings["heat|1995"]).toEqual({ rating: 5, date: "2023-05-01" });
    expect(imp.ratings["bad rating|1995"]).toBeUndefined();
    // ratings.csv is authoritative: diary-only ratings aren't added.
    expect(imp.ratings["crouching tiger hidden dragon|2000"]).toBeUndefined();
  });

  it("reads watchlist and watched films", () => {
    expect(imp.watchlist["past lives|2023"]).toEqual({ date: "2024-04-01" });
    expect(imp.watched["heat|1995"]).toEqual({ date: "2020-01-01" });
    expect(imp.watched["crouching tiger hidden dragon|2000"]).toEqual({ date: "2024-01-01" });
  });

  it("summarizes the import", () => {
    expect(summarizeImport(imp)).toEqual({
      films: 5,
      diaryEntries: 4,
      rewatches: 1,
      ratings: 2,
      watchlist: 1,
      undated: 1,
    });
  });
});

describe("buildImport with a single file", () => {
  it("falls back to the latest diary rating without ratings.csv", () => {
    const imp = buildImport([{ name: "diary.csv", text: DIARY }], "diary.csv");
    expect(imp.ratings["dune|2021"]).toEqual({ rating: 5, date: "2024-03-01" });
    expect(imp.ratings["crouching tiger hidden dragon|2000"]?.rating).toBe(4.5);
  });

  it("recognizes a renamed diary by its headers", () => {
    const imp = buildImport([{ name: "my-export.csv", text: DIARY }], "my-export.csv");
    expect(imp.diary).toHaveLength(4);
  });

  it("de-duplicates entry ids when URIs are missing", () => {
    const csv = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2024-01-01,Heat,1995,,,,,2024-01-01
2024-01-01,Heat,1995,,,Yes,,2024-01-01
`;
    const imp = buildImport([{ name: "diary.csv", text: csv }], "diary.csv");
    expect(new Set(imp.diary.map((d) => d.id)).size).toBe(2);
  });

  it("rejects unrelated CSVs", () => {
    expect(() => buildImport([{ name: "x.csv", text: "a,b\n1,2\n" }], "x.csv")).toThrow(
      ImportError,
    );
  });
});

describe("extractZip", () => {
  it("reads export files and skips deleted/orphaned copies", () => {
    const zip = zipSync({
      "diary.csv": strToU8(DIARY),
      "ratings.csv": strToU8(RATINGS),
      "deleted/diary.csv": strToU8("Date,Name,Year\n2020-01-01,Deleted,2000\n"),
      "orphaned/watched.csv": strToU8("Date,Name,Year\n2020-01-01,Orphan,2000\n"),
      "likes/films.csv": strToU8("Date,Name,Year\n"),
      "profile.csv": strToU8("Username\nme\n"),
    });
    const files = extractZip(zip);
    expect(files.map((f) => f.name).sort()).toEqual(["diary.csv", "ratings.csv"]);
    const imp = buildImport(files, "x.zip");
    expect(Object.values(imp.films).some((f) => f.title === "Deleted")).toBe(false);
  });

  it("handles exports re-zipped inside a folder", () => {
    const zip = zipSync({ "letterboxd-me-2024/diary.csv": strToU8(DIARY) });
    expect(extractZip(zip).map((f) => f.name)).toEqual(["diary.csv"]);
  });

  it("explains corrupt files", () => {
    expect(() => extractZip(new Uint8Array([1, 2, 3, 4]))).toThrow(ImportError);
  });
});
