const numberFormat = new Intl.NumberFormat("en-US");

export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

/** "1 film", "1,204 films". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : pluralForm}`;
}

/** Join with commas and "and": ["a", "b", "c"] → "a, b and c". */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** A rough duration: "less than a minute", "about 6 minutes", "about 1 hour 5 minutes". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 50) return "less than a minute";
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return `about ${plural(m, "minute")}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `about ${plural(h, "hour")}${rest ? ` ${plural(rest, "minute")}` : ""}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "★★★½" for 3.5 stars. */
export function stars(rating: number): string {
  const full = Math.floor(rating);
  return "★".repeat(full) + (rating - full >= 0.5 ? "½" : "");
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Format a YYYY-MM-DD calendar date without shifting it through a time zone. */
export function formatDate(date: string): string {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

export function traktMovieUrl(slug: string): string {
  return `https://trakt.tv/movies/${encodeURIComponent(slug)}`;
}
