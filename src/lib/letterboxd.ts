import { unzipSync } from "fflate";
import Papa from "papaparse";
import { isIsoDate } from "./dates";
import { filmKey } from "./matching";
import type { DatedFilm, DiaryEntry, Film, FilmRating, LetterboxdImport } from "./types";

export class ImportError extends Error {
  override name = "ImportError";
}

type ExportFile = "diary" | "ratings" | "watchlist" | "watched";

const EXPORT_FILES: Record<string, ExportFile> = {
  "diary.csv": "diary",
  "ratings.csv": "ratings",
  "watchlist.csv": "watchlist",
  "watched.csv": "watched",
};

/** Folders in the Letterboxd export that hold data we must not import. */
const IGNORED_DIRS = new Set(["deleted", "orphaned", "likes", "lists"]);

type Row = Record<string, string | undefined>;

export interface SourceFile {
  name: string;
  text: string;
}

function basename(path: string): string {
  return path.split("/").pop()?.toLowerCase() ?? "";
}

function isWantedZipPath(path: string): boolean {
  const parts = path.split("/");
  if (parts.slice(0, -1).some((dir) => IGNORED_DIRS.has(dir.toLowerCase()))) return false;
  return basename(path) in EXPORT_FILES;
}

/** Pull the CSVs we care about out of a Letterboxd export ZIP. */
export function extractZip(data: Uint8Array): SourceFile[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, { filter: (f) => isWantedZipPath(f.name) });
  } catch {
    throw new ImportError("That ZIP file couldn't be opened. Try downloading the export again.");
  }
  // Prefer the shallowest copy of each file, in case the ZIP was re-packed with a folder.
  const chosen = new Map<string, string>();
  for (const path of Object.keys(entries).sort((a, b) => a.length - b.length)) {
    const name = basename(path);
    if (!chosen.has(name)) chosen.set(name, path);
  }
  const decoder = new TextDecoder("utf-8");
  return [...chosen.entries()].map(([name, path]) => ({
    name,
    text: decoder.decode(entries[path]),
  }));
}

function parseCsv(text: string): { rows: Row[]; headers: string[] } {
  const result = Papa.parse<Row>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return { rows: result.data, headers: result.meta.fields ?? [] };
}

function detectKind(name: string, headers: string[]): ExportFile | null {
  const known = EXPORT_FILES[basename(name)];
  if (known) return known;
  if (!headers.includes("Name")) return null;
  if (headers.includes("Watched Date")) return "diary";
  if (headers.includes("Rating")) return "ratings";
  if (/watchlist/i.test(name)) return "watchlist";
  return "watched";
}

function parseYear(value: string | undefined): number | null {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 1800 && n < 3000 ? n : null;
}

function parseStars(value: string | undefined): number | null {
  const n = Number.parseFloat(value ?? "");
  if (!Number.isFinite(n) || n < 0.5 || n > 5) return null;
  return Math.round(n * 2) / 2;
}

function parseDate(value: string | undefined): string | null {
  const v = value?.trim() ?? "";
  return isIsoDate(v) ? v : null;
}

/** Combine the CSVs from a Letterboxd export into one normalized import. */
export function buildImport(files: SourceFile[], sourceName: string): LetterboxdImport {
  const films: Record<string, Film> = {};
  const diary: DiaryEntry[] = [];
  const ratings: Record<string, FilmRating> = {};
  const watchlist: Record<string, DatedFilm> = {};
  const watched: Record<string, DatedFilm> = {};
  const diaryIds = new Set<string>();
  let recognized = 0;
  let sawRatingsFile = false;

  const film = (row: Row): Film | null => {
    const title = row.Name?.trim();
    if (!title) return null;
    const year = parseYear(row.Year);
    const key = filmKey(title, year);
    films[key] ??= { key, title, year };
    return films[key];
  };

  for (const file of files) {
    const { rows, headers } = parseCsv(file.text);
    const kind = detectKind(file.name, headers);
    if (!kind) continue;
    recognized++;
    if (kind === "ratings") sawRatingsFile = true;

    for (const row of rows) {
      const f = film(row);
      if (!f) continue;
      const date = parseDate(row.Date);

      switch (kind) {
        case "diary": {
          const watchedDate = parseDate(row["Watched Date"]) ?? date;
          if (!watchedDate) break;
          const uri = row["Letterboxd URI"]?.trim();
          let id = uri || `${f.key}@${watchedDate}`;
          for (let n = 2; diaryIds.has(id); n++) id = `${uri || `${f.key}@${watchedDate}`}#${n}`;
          diaryIds.add(id);
          diary.push({
            id,
            filmKey: f.key,
            watchedDate,
            rating: parseStars(row.Rating),
            rewatch: row.Rewatch?.trim().toLowerCase() === "yes",
          });
          break;
        }
        case "ratings": {
          const rating = parseStars(row.Rating);
          if (rating != null) ratings[f.key] = { rating, date };
          break;
        }
        case "watchlist":
          watchlist[f.key] = { date };
          break;
        case "watched":
          watched[f.key] = { date };
          break;
      }
    }
  }

  if (recognized === 0) {
    throw new ImportError(
      "We couldn't find diary.csv, ratings.csv, watched.csv or watchlist.csv. Upload the ZIP file from Letterboxd's export page.",
    );
  }

  diary.sort((a, b) => a.watchedDate.localeCompare(b.watchedDate));

  // ratings.csv holds current ratings. Without it (e.g. only diary.csv was uploaded),
  // fall back to each film's most recent rated diary entry.
  if (!sawRatingsFile) {
    for (const entry of diary) {
      if (entry.rating != null) {
        ratings[entry.filmKey] = { rating: entry.rating, date: entry.watchedDate };
      }
    }
  }

  // Every diary film counts as watched, even when watched.csv wasn't uploaded.
  for (const entry of diary) watched[entry.filmKey] ??= { date: entry.watchedDate };

  if (Object.keys(films).length === 0) {
    throw new ImportError("The export doesn't contain any films yet.");
  }

  return {
    sourceName,
    importedAt: new Date().toISOString(),
    films,
    diary,
    ratings,
    watchlist,
    watched,
  };
}

/** Read a user-selected ZIP or CSV file into an import. */
export async function readExportFile(file: File): Promise<LetterboxdImport> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".zip") || file.type === "application/zip") {
    const files = extractZip(new Uint8Array(await file.arrayBuffer()));
    return buildImport(files, file.name);
  }
  if (lower.endsWith(".csv") || file.type === "text/csv") {
    return buildImport([{ name: file.name, text: await file.text() }], file.name);
  }
  throw new ImportError(
    "Choose the .zip file from Letterboxd, or one of the .csv files inside it.",
  );
}
