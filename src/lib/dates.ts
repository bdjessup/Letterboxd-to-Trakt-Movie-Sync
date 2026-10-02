const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function zonedParts(timestamp: number, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(timestamp))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** The calendar date (YYYY-MM-DD) an instant falls on in `timeZone`. */
export function toLocalDate(iso: string, timeZone: string): string {
  const p = zonedParts(Date.parse(iso), timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** The calendar date (YYYY-MM-DD) an instant falls on in UTC. */
export function toUtcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Noon on `date` in `timeZone`, as a UTC ISO timestamp.
 *
 * Letterboxd only records dates. Noon keeps the play on the same calendar day for the
 * user and avoids the midnight edge where a UTC timestamp lands on the previous day.
 */
export function localNoonToIso(date: string, timeZone: string): string {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  const p = zonedParts(guess, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = asIfUtc - guess;
  return new Date(guess - offset).toISOString();
}

/** Today's date (YYYY-MM-DD) in `timeZone`. */
export function today(timeZone: string): string {
  return toLocalDate(new Date().toISOString(), timeZone);
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
