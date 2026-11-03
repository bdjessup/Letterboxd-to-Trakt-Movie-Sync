import { ArrowRightIcon, BookmarkIcon, CheckIcon, LockIcon, RepeatIcon, StarIcon } from "./icons";
import { LibraryPreview } from "./library-preview";
import { Alert, buttonClass } from "./ui";

const STEPS = [
  {
    title: "Connect your Trakt",
    body: "Sign in on Trakt and give this app permission to update your library. No new account needed.",
  },
  {
    title: "Bring your Letterboxd export",
    body: "Download your data from Letterboxd, then drop the ZIP here. We'll read it in your browser.",
  },
  {
    title: "Make it yours, then sync",
    body: "Choose what to include, check the film matches and approve the changes. You're in control.",
  },
];

const INCLUDED = [
  {
    icon: RepeatIcon,
    title: "Every watch. Every rewatch.",
    detail:
      "Keep the original dates from your diary. Plays already on Trakt are checked before we add new ones.",
    color: "text-good bg-good-soft",
  },
  {
    icon: StarIcon,
    title: "Your taste, translated.",
    detail:
      "Your half-stars become Trakt ratings. Existing ratings stay as they are unless you choose to replace them.",
    color: "text-brand-ink bg-brand-soft",
  },
  {
    icon: BookmarkIcon,
    title: "The next great movie night.",
    detail:
      "Bring along your watchlist, too. Films you've already watched on Trakt are automatically left out.",
    color: "text-info bg-info-soft",
  },
];

export function Landing({ configured }: { configured: boolean }) {
  return (
    <div className="landing">
      <section aria-labelledby="landing-title" className="cinema-hero">
        <div className="hero-copy">
          <h1 id="landing-title">
            Your film diary.
            <br />
            Now playing
            <br />
            on Trakt.
          </h1>
          <p className="hero-description">
            All those films. All those feelings. Bring your Letterboxd watch history, ratings and
            watchlist to Trakt, without logging them twice.
          </p>
          <div className="hero-actions">
            {configured ? (
              <a href="/api/auth/login" className={buttonClass("primary", "lg", "hero-connect")}>
                <img src="/trakt-logo.svg" alt="" width={24} height={24} className="size-6" />
                Connect Trakt
                <ArrowRightIcon className="ml-3 size-4" />
              </a>
            ) : (
              <div className="rounded-2xl bg-surface text-ink">
                <Alert tone="warn" title="Trakt connection is temporarily unavailable">
                  Please check back soon to connect your account.
                </Alert>
              </div>
            )}
            <a href="#how-it-works" className="hero-how">
              How it works
            </a>
          </div>
          <p className="hero-note">
            <LockIcon className="size-3.5" /> You review every change before syncing.
          </p>
        </div>
        <LibraryPreview />
      </section>

      <ul className="trust-strip" aria-label="Good to know">
        <li>
          <CheckIcon /> Free to use
        </li>
        <li>
          <LockIcon /> Your export stays in your browser
        </li>
        <li>
          <RepeatIcon /> Rewatch dates preserved
        </li>
      </ul>

      <section aria-labelledby="included-title" className="included-section">
        <div className="section-intro">
          <h2 id="included-title">A new home for your film life.</h2>
          <p>You did the watching. We'll handle the moving.</p>
        </div>
        <ul className="feature-grid">
          {INCLUDED.map(({ icon: Icon, title, detail, color }) => (
            <li key={title}>
              <span className={`feature-icon ${color}`}>
                <Icon className="size-5" />
              </span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="how-it-works" aria-labelledby="how-title" className="how-section">
        <div className="section-intro">
          <h2 id="how-title">From one library to the other.</h2>
          <p>Three steps, and you're ready for the next film.</p>
        </div>
        <ol className="how-steps">
          {STEPS.map(({ title, body }, index) => (
            <li key={title}>
              <span className="how-number">{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="how-note">
          <RepeatIcon className="size-4 shrink-0" />
          Logged more films? Come back with a fresh export. This is a one-way import, run whenever
          you need it.
        </p>
      </section>
    </div>
  );
}
