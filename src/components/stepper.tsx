import type { Stage } from "@/hooks/use-sync-engine";
import { CheckIcon } from "./icons";
import { cx } from "./ui";

const STEPS = ["Upload", "Choose", "Review", "Sync"] as const;

const STAGE_INDEX: Record<Stage, number> = {
  upload: 0,
  options: 1,
  analyzing: 1,
  review: 2,
  syncing: 3,
  done: 4,
};

export function Stepper({ stage }: { stage: Stage }) {
  const current = STAGE_INDEX[stage];
  return (
    <nav aria-label="Import progress" className="workflow-stepper mb-5">
      <ol className="flex items-start gap-1 sm:items-center sm:gap-2">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={label}
              className="relative flex flex-1 items-center justify-center sm:justify-start sm:gap-2 last:sm:flex-none"
            >
              <span
                aria-current={active ? "step" : undefined}
                className={cx(
                  "relative z-10 flex flex-col items-center gap-2 text-xs font-medium whitespace-nowrap sm:flex-row sm:text-sm",
                  active ? "text-ink" : done ? "text-ink-2" : "text-ink-3",
                )}
              >
                <span
                  className={cx(
                    "grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold ring-4 ring-surface",
                    done && "bg-good text-white dark:text-black",
                    active && "bg-brand text-white",
                    !done && !active && "bg-surface-3 text-ink-3",
                  )}
                >
                  {done ? <CheckIcon className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span>{label}</span>
                {done && <span className="sr-only">(done)</span>}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cx(
                    "absolute top-4 left-1/2 h-px w-full sm:static sm:min-w-3 sm:flex-1",
                    done ? "bg-good/50" : "bg-line-strong",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
