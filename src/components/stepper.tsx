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
    <nav aria-label="Progress" className="mb-6">
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                aria-current={active ? "step" : undefined}
                className={cx(
                  "flex items-center gap-2 text-sm font-medium whitespace-nowrap",
                  active ? "text-ink" : done ? "text-ink-2" : "text-ink-3",
                )}
              >
                <span
                  className={cx(
                    "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                    done && "bg-good text-white dark:text-black",
                    active && "bg-brand text-white",
                    !done && !active && "bg-surface-3 text-ink-3",
                  )}
                >
                  {done ? <CheckIcon className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cx(!active && "max-sm:sr-only")}>{label}</span>
                {done && <span className="sr-only">(done)</span>}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cx("h-px min-w-3 flex-1", done ? "bg-good/50" : "bg-line-strong")}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
