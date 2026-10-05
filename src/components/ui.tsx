import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { AlertIcon, CheckIcon, XIcon } from "./icons";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "sm";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover shadow-sm",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3 ring-1 ring-inset ring-line",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-bad-soft text-bad hover:brightness-95",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-11 px-4 text-[15px] gap-2 rounded-xl",
  lg: "h-12 px-5 text-base gap-2 rounded-xl",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cx(
    "inline-flex select-none items-center justify-center font-medium whitespace-nowrap transition-colors",
    "disabled:pointer-events-none disabled:opacity-45",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant,
  size,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return <a className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cx("rounded-3xl bg-surface p-5 shadow-card ring-1 ring-line sm:p-7", className)}
      {...props}
    >
      {children}
    </section>
  );
}

type Tone = "neutral" | "brand" | "good" | "warn" | "bad" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 ring-line",
  brand: "bg-brand-soft text-brand-ink ring-transparent",
  good: "bg-good-soft text-good ring-transparent",
  warn: "bg-warn-soft text-warn ring-transparent",
  bad: "bg-bad-soft text-bad ring-transparent",
  info: "bg-info-soft text-info ring-transparent",
};

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = "bad",
  title,
  children,
  onDismiss,
  action,
}: {
  tone?: "bad" | "warn" | "info" | "good";
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  action?: ReactNode;
}) {
  const Icon = tone === "good" ? CheckIcon : AlertIcon;
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cx(
        "flex gap-3 rounded-2xl p-4 text-sm",
        tone === "bad" && "bg-bad-soft text-ink",
        tone === "warn" && "bg-warn-soft text-ink",
        tone === "info" && "bg-info-soft text-ink",
        tone === "good" && "bg-good-soft text-ink",
      )}
    >
      <Icon
        className={cx(
          "mt-0.5 size-4 shrink-0",
          tone === "bad" && "text-bad",
          tone === "warn" && "text-warn",
          tone === "info" && "text-info",
          tone === "good" && "text-good",
        )}
      />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
        {action && <div className="pt-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="-m-1 size-7 shrink-0 rounded-lg p-1.5 text-ink-3 hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
          aria-label="Dismiss"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-start justify-between gap-4 py-3",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="min-w-0">
        <span className="block font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-ink-3">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          aria-hidden="true"
          className={cx(
            "h-[30px] w-[50px] rounded-full bg-surface-3 ring-1 ring-inset ring-line transition-colors",
            "peer-checked:bg-good peer-checked:ring-transparent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand",
          )}
        />
        <span
          aria-hidden="true"
          className="absolute top-[2px] left-[2px] size-[26px] rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-5"
        />
      </span>
    </label>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-letterboxd-green via-brand to-brand transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(pct, max > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx("animate-spin", className ?? "size-4")}
      aria-hidden="true"
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cx("font-medium text-brand-ink underline-offset-2 hover:underline", className)}
    >
      {children}
    </a>
  );
}
