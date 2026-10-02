import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { traktMovieUrl } from "@/lib/format";
import type { FilmPlan } from "@/lib/plan";
import type { TraktMovieRef } from "@/lib/types";
import { findMovies } from "@/server/functions";
import { ExternalIcon, SearchIcon, XIcon } from "./icons";
import { Alert, Button, Spinner } from "./ui";

/** Search Trakt by hand to fix a missing or wrong match. */
export function MatchDialog({
  film,
  onChoose,
  onClose,
}: {
  film: FilmPlan | null;
  onChoose: (movie: TraktMovieRef | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [results, setResults] = useState<TraktMovieRef[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (q: string, y: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const yearNum = /^\d{4}$/.test(y.trim()) ? Number(y.trim()) : null;
      const res = await findMovies({ data: { query: q.trim(), year: yearNum } });
      if (res.ok) setResults(res.data);
      else setError(res.error.message);
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (film) {
      const y = film.film.year ? String(film.film.year) : "";
      setQuery(film.film.title);
      setYear(y);
      setResults(null);
      if (!dialog.open) dialog.showModal();
      void search(film.film.title, y);
    } else if (dialog.open) {
      dialog.close();
    }
  }, [film, search]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void search(query, year);
  };

  const current = film?.resolution?.status === "matched" ? film.resolution.movie.trakt : null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] max-h-[min(40rem,calc(100dvh-2rem))] overflow-hidden rounded-3xl bg-surface p-0 text-ink shadow-2xl ring-1 ring-line backdrop:bg-black/40"
    >
      {film && (
        <div className="flex max-h-[inherit] flex-col">
          <div className="flex items-start justify-between gap-4 p-5 pb-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                Find on Trakt
              </h2>
              <p className="truncate text-sm text-ink-3">
                Letterboxd: {film.film.title}
                {film.film.year ? ` (${film.film.year})` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="-m-1.5 rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
              aria-label="Close"
            >
              <XIcon className="size-5" />
            </button>
          </div>

          <form onSubmit={onSubmit} className="flex gap-2 px-5">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Title</span>
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 w-full rounded-xl bg-surface-2 pr-3 pl-9 ring-1 ring-line ring-inset focus:ring-2 focus:ring-brand focus:outline-none"
                placeholder="Title"
                autoFocus
              />
            </label>
            <label className="w-24">
              <span className="sr-only">Year</span>
              <input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                inputMode="numeric"
                maxLength={4}
                className="h-11 w-full rounded-xl bg-surface-2 px-3 ring-1 ring-line ring-inset focus:ring-2 focus:ring-brand focus:outline-none"
                placeholder="Year"
              />
            </label>
            <Button type="submit" variant="secondary" disabled={loading}>
              Search
            </Button>
          </form>

          <div className="mt-3 min-h-40 flex-1 overflow-y-auto px-3 pb-2">
            {loading ? (
              <div className="flex h-40 items-center justify-center gap-2 text-ink-3">
                <Spinner /> Searching Trakt…
              </div>
            ) : error ? (
              <div className="p-2">
                <Alert>{error}</Alert>
              </div>
            ) : results && results.length === 0 ? (
              <p className="p-6 text-center text-ink-3">
                No movies found. Try the original title, or leave the year empty.
              </p>
            ) : (
              <ul className="space-y-1">
                {results?.map((m) => (
                  <li
                    key={m.trakt}
                    className="flex items-center gap-2 rounded-2xl p-2 hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1 px-1">
                      <p className="truncate font-medium">
                        {m.title} {m.year ? <span className="text-ink-3">({m.year})</span> : null}
                      </p>
                      <a
                        href={traktMovieUrl(m.slug)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-brand-ink"
                      >
                        View on Trakt <ExternalIcon className="size-3" />
                      </a>
                    </div>
                    <Button
                      size="sm"
                      variant={m.trakt === current ? "secondary" : "primary"}
                      onClick={() => onChoose(m)}
                    >
                      {m.trakt === current ? "Current" : "Use this"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line p-4">
            <Button variant="ghost" size="sm" onClick={() => onChoose(null)}>
              It's not on Trakt
            </Button>
            <Button variant="secondary" size="sm" onClick={() => ref.current?.close()}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
