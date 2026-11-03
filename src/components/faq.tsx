import type { ReactNode } from "react";
import { ChevronDownIcon } from "./icons";

const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: "Does this sync in both directions automatically?",
    a: "This tool imports Letterboxd data into Trakt when you run it. It doesn't change your Letterboxd account or run in the background. Download a fresh Letterboxd export and run another check whenever you're ready to update Trakt.",
  },
  {
    q: "Do I need to upload my Trakt data too?",
    a: "No. Connect your Trakt account and the app reads your existing history, ratings and watchlist directly. You only need the ZIP export from Letterboxd's Settings, under Data.",
  },
  {
    q: "Will this create duplicate plays?",
    a: "Before syncing, the app checks your Trakt history. It skips a diary entry when that film already has a play on the same day in your Trakt time zone. Each existing play covers one diary entry, so separate rewatches are preserved. Review the changes before sending them.",
  },
  {
    q: "Will my existing ratings or watch history be replaced?",
    a: "Existing plays stay in place. Letterboxd's half-stars convert to Trakt's 1 to 10 scale, so 3.5 stars becomes 7. If Trakt already has a different rating, it's kept unless you choose to replace it. You choose whether to include ratings and your watchlist.",
  },
  {
    q: "What about watched films without a diary date?",
    a: "Letterboxd doesn't record when you watched those. They're left out by default. You can include them using the date you marked them watched instead.",
  },
  {
    q: "What happens when a film match is uncertain?",
    a: 'Letterboxd exports use titles and years, so translated titles, re-releases and shorts may need a check. Uncertain matches are left out until you approve them. Use "Find" to choose a film manually when no match is found.',
  },
  {
    q: "Where is my data stored?",
    a: "Your export is read and saved in this browser so you can resume later. The site doesn't store your movie library on a server. Film titles are sent to Trakt to find matches, and only approved changes are added to your account. Your Trakt sign-in stays in an encrypted, HTTP-only cookie. You can sign out or clear saved browser data at any time.",
  },
  {
    q: "How long does an import take?",
    a: "The first check takes longer because each film needs a match. Large libraries can take several minutes. The app respects Trakt's request limits and saves matches in this browser for later imports. Keep this tab open while a check or sync is running.",
  },
];

export function Faq() {
  return (
    <section id="questions" aria-labelledby="faq-title" className="faq-section">
      <div className="section-intro">
        <h2 id="faq-title">Before the opening credits.</h2>
        <p>A few answers before you bring your films over.</p>
      </div>
      <div className="divide-y divide-line border-y border-line">
        {QUESTIONS.map(({ q, a }) => (
          <details key={q} className="group" name="questions">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-1 py-4 font-medium transition-colors hover:text-brand-ink [&::-webkit-details-marker]:hidden">
              {q}
              <ChevronDownIcon className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" />
            </summary>
            <p className="max-w-[65ch] px-1 pb-5 text-sm leading-relaxed text-ink-2">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
