import { LockIcon, RepeatIcon, StarIcon } from "./icons";
import { Alert, buttonClass, cx } from "./ui";

const FEATURES = [
  {
    icon: RepeatIcon,
    title: "Every diary entry",
    body: "Each log becomes a play on the day you watched it, rewatches included.",
  },
  {
    icon: StarIcon,
    title: "Ratings and watchlist",
    body: "Half-stars convert to Trakt's 1–10 scale. Your watchlist comes along too.",
  },
  {
    icon: LockIcon,
    title: "Safe to re-run",
    body: "We check your Trakt history first, so nothing is ever added twice.",
  },
];

export function Landing({ configured }: { configured: boolean }) {
  return (
    <div className="pt-10 sm:pt-16">
      <div className="text-center">
        <h1 className="text-[2rem] leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
          Bring your Letterboxd diary to Trakt
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-pretty text-ink-2">
          Copy your watch history, ratings and watchlist from a Letterboxd export to your Trakt
          account. Review every change before anything is sent.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          {configured ? (
            <a href="/api/auth/login" className={buttonClass("primary", "lg", "min-w-56")}>
              <img src="/trakt-logo.svg" alt="" className="size-6" />
              Connect Trakt
            </a>
          ) : (
            <div className="w-full max-w-md text-left">
              <Alert tone="warn" title="This site isn't set up yet">
                Add <code>TRAKT_CLIENT_ID</code>, <code>TRAKT_CLIENT_SECRET</code> and{" "}
                <code>SESSION_SECRET</code>. The README explains how.
              </Alert>
            </div>
          )}
          <p className="text-sm text-ink-3">Free. No account here, just your Trakt sign-in.</p>
        </div>
      </div>

      <ul className="mt-14 grid gap-3 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="rounded-3xl bg-surface p-5 shadow-card ring-1 ring-line">
            <span
              className={cx(
                "grid size-10 place-items-center rounded-2xl",
                i === 0 && "bg-good-soft text-good",
                i === 1 && "bg-warn-soft text-warn",
                i === 2 && "bg-brand-soft text-brand-ink",
              )}
            >
              <Icon className="size-5" />
            </span>
            <h2 className="mt-4 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-ink-2">{body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
