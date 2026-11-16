import type { LetterboxdImport } from "./types";

export interface ImportSummary {
  films: number;
  diaryEntries: number;
  rewatches: number;
  ratings: number;
  watchlist: number;
  /** Films marked watched with no diary entry, so no watch date. */
  undated: number;
}

export function summarizeImport(imp: LetterboxdImport): ImportSummary {
  const inDiary = new Set<string>();
  let rewatches = 0;
  for (const entry of imp.diary) {
    if (entry.rewatch || inDiary.has(entry.filmKey)) rewatches++;
    inDiary.add(entry.filmKey);
  }
  const withData = new Set([
    ...inDiary,
    ...Object.keys(imp.ratings),
    ...Object.keys(imp.watchlist),
    ...Object.keys(imp.watched),
  ]);
  return {
    films: withData.size,
    diaryEntries: imp.diary.length,
    rewatches,
    ratings: Object.keys(imp.ratings).length,
    watchlist: Object.keys(imp.watchlist).length,
    undated: Object.keys(imp.watched).filter((k) => !inDiary.has(k)).length,
  };
}
