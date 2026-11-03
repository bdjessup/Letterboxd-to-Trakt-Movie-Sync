import { useId, useState } from "react";
import { ArrowRightIcon, BookmarkIcon, CheckIcon, LogoMark, RepeatIcon, StarIcon } from "./icons";

const PREVIEWS = {
  history: {
    label: "History",
    icon: RepeatIcon,
    title: "The dates. The rewatches. All there.",
    description: "Your diary entries become plays on the same dates in Trakt.",
    details: ["Oct 12, 2024", "Oct 18, 2024", "Oct 24, 2024"],
  },
  ratings: {
    label: "Ratings",
    icon: StarIcon,
    title: "Same opinion. A different scale.",
    description: "Letterboxd's half-stars convert to Trakt's 1 to 10 ratings.",
    details: ["4½ stars → 9/10", "5 stars → 10/10", "4 stars → 8/10"],
  },
  watchlist: {
    label: "Watchlist",
    icon: BookmarkIcon,
    title: "Keep your next great watch in sight.",
    description: "Your saved films come along, unless they're already watched on Trakt.",
    details: ["On your watchlist", "On your watchlist", "On your watchlist"],
  },
};

type PreviewKind = keyof typeof PREVIEWS;
const KINDS: PreviewKind[] = ["history", "ratings", "watchlist"];
const FILMS = [
  { title: "Dune", year: 2021, artwork: "dune" },
  { title: "Past Lives", year: 2023, artwork: "past-lives" },
  { title: "Perfect Days", year: 2023, artwork: "perfect-days" },
];

export function LibraryPreview() {
  const [kind, setKind] = useState<PreviewKind>("history");
  const preview = PREVIEWS[kind];
  const panelId = useId();

  return (
    <figure className="library-preview" aria-label="Interactive example library">
      <div className="preview-route">
        <span>
          <LogoMark className="h-3.5 w-9" /> Letterboxd
        </span>
        <span className="preview-route-line">
          <ArrowRightIcon className="size-4" />
        </span>
        <span>
          <img src="/trakt-logo.svg" alt="" width={22} height={22} /> Trakt
        </span>
      </div>

      <div className="preview-films">
        {FILMS.map((film, index) => (
          <div className="preview-film" key={film.title}>
            <div className={`film-art film-art-${film.artwork}`} aria-hidden="true">
              <span className="film-art-shape" />
              <span className="film-art-title">{film.title}</span>
              <span className="film-art-year">{film.year}</span>
            </div>
            <p className="preview-film-title">{film.title}</p>
            <p className="preview-film-detail">{preview.details[index]}</p>
          </div>
        ))}
      </div>

      <fieldset className="preview-controls">
        <legend className="sr-only">Choose an example to preview</legend>
        {KINDS.map((value) => {
          const { label, icon: Icon } = PREVIEWS[value];
          return (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              aria-controls={panelId}
              onClick={() => setKind(value)}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          );
        })}
      </fieldset>

      <div id={panelId} className="preview-caption" aria-live="polite" aria-atomic="true">
        <span className="preview-check">
          <CheckIcon className="size-4" />
        </span>
        <div>
          <p>{preview.title}</p>
          <span className="preview-caption-description">{preview.description}</span>
        </div>
      </div>
      <figcaption className="preview-disclaimer">
        Example library. Your films take center stage after connecting.
      </figcaption>
    </figure>
  );
}
