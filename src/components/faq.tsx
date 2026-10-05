import type { ReactNode } from "react";
import { ChevronDownIcon } from "./icons";

const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: "Will this create duplicate plays?",
    a: "No. Before anything is sent we read your Trakt history. A diary entry is skipped when that film already has a play on the same day, so you can run the sync again whenever you've logged more films and only the new entries are added.",
  },
  {
    q: "How are ratings converted?",
    a: "Letterboxd's half-stars double to Trakt's 1–10 scale: ★★★½ becomes 7, ★★★★★ becomes 10. If Trakt already has a different rating for a film, it's kept unless you choose to replace it.",
  },
  {
    q: "What about rewatches?",
    a: "Each diary entry becomes its own play on Trakt, so a film you logged three times shows three plays.",
  },
  {
    q: "What about films I marked watched without logging them?",
    a: "Letterboxd doesn't record when you watched those. You can include them dated to the day you marked them watched, or leave them out (the default).",
  },
  {
    q: "Why can't some films be found?",
    a: "Letterboxd exports only titles and years, so films are matched by searching Trakt. Translated titles, re-releases and shorts sometimes don't line up. Use “Find” on any film to pick the right one by hand.",
  },
  {
    q: "What happens to my data?",
    a: "Your export is read in your browser and saved there so you can pick up where you left off. Only the changes you approve are sent to Trakt. Your Trakt sign-in is kept in an encrypted, HTTP-only cookie, and signing out revokes it.",
  },
  {
    q: "How long does it take?",
    a: "Trakt limits how quickly apps can search, so matching runs at about two or three films a second. Matches are remembered in your browser, so later runs take seconds. Sending changes takes about a second per 100 items.",
  },
];

export function Faq() {
  return (
    <section aria-labelledby="faq-title" className="mt-16">
      <h2 id="faq-title" className="text-lg font-semibold tracking-tight">
        Questions
      </h2>
      <div className="mt-3 divide-y divide-line overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-line">
        {QUESTIONS.map(({ q, a }) => (
          <details key={q} className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-medium hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
              {q}
              <ChevronDownIcon className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" />
            </summary>
            <p className="px-5 pb-4 text-ink-2">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
