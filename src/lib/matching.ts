import type { MatchConfidence, TraktMovieRef } from "./types";

/** Lowercase, strip accents and punctuation, and spell out "&" so titles compare loosely. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const LEADING_ARTICLE = /^(the|a|an|le|la|les|el|los|las|il|der|die|das) /;

function withoutArticle(normalized: string): string {
  return normalized.replace(LEADING_ARTICLE, "");
}

export function filmKey(title: string, year: number | null): string {
  return `${normalizeTitle(title)}|${year ?? ""}`;
}

/** Sørensen–Dice similarity of character bigrams, 0–1. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = bigrams.get(g) ?? 0;
    if (n > 0) {
      bigrams.set(g, n - 1);
      overlap++;
    }
  }
  return (2 * overlap) / (a.length + b.length - 2);
}

function titleScore(wanted: string, candidate: string): number {
  const a = normalizeTitle(wanted);
  const b = normalizeTitle(candidate);
  if (a === b) return 1;
  if (withoutArticle(a) === withoutArticle(b)) return 0.97;
  return similarity(withoutArticle(a), withoutArticle(b));
}

export interface Match {
  movie: TraktMovieRef;
  confidence: Exclude<MatchConfidence, "manual">;
}

/**
 * Choose the Trakt movie that best matches a Letterboxd title and year.
 *
 * "exact" means the titles match (ignoring case, accents and punctuation) and the year
 * is the same. "likely" covers off-by-one years (release dates differ between
 * databases), near-identical titles, and the top hit for the exact year when titles
 * differ (often a translated title). Likely matches are shown to the user for review.
 */
export function pickBestMatch(
  title: string,
  year: number | null,
  results: TraktMovieRef[],
  { yearFiltered = false }: { yearFiltered?: boolean } = {},
): Match | null {
  let best: { movie: TraktMovieRef; score: number; exact: boolean } | null = null;

  for (const [rank, movie] of results.entries()) {
    const t = titleScore(title, movie.title);
    const yearDelta = year != null && movie.year != null ? Math.abs(year - movie.year) : null;
    const sameYear = yearDelta === 0 || (year == null && movie.year == null);
    const closeYear = yearDelta != null && yearDelta <= 1;

    let score = 0;
    let exact = false;
    if (t === 1 && sameYear) {
      score = 3;
      exact = true;
    } else if (t >= 0.97 && (sameYear || closeYear || year == null)) {
      score = 2.5;
    } else if (t >= 0.8 && (sameYear || closeYear)) {
      score = 2 + t / 10;
    } else if (rank === 0 && sameYear && yearFiltered) {
      // Trakt also searches translations and aliases, so its top hit for the
      // right year is usually right even when the display title differs.
      score = 1;
    }
    score -= rank * 0.001;
    if (score > 0 && (!best || score > best.score)) best = { movie, score, exact };
  }

  if (!best) return null;
  return { movie: best.movie, confidence: best.exact ? "exact" : "likely" };
}

/** Letterboxd half-stars (0.5–5) → Trakt hearts (1–10). */
export function toTraktRating(stars: number): number {
  return Math.min(10, Math.max(1, Math.round(stars * 2)));
}
