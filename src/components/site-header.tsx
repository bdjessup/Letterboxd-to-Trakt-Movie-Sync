import { useRouter } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import type { Viewer } from "@/lib/types";
import { signOut } from "@/server/functions";
import { ChevronDownIcon, ExternalIcon, LogOutIcon, LogoMark } from "./icons";
import { Alert, cx } from "./ui";

export function SiteHeader({
  viewer,
  onSignOut,
}: {
  viewer: Viewer | null;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex min-h-20 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <a
          href="/"
          className="flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold tracking-tight sm:gap-2.5 sm:text-base"
        >
          <LogoMark className="h-3 w-8 shrink-0 sm:h-3.5 sm:w-9" />
          <span className="whitespace-nowrap">
            Letterboxd <span className="text-ink-3">→</span> Trakt
          </span>
        </a>
        {viewer ? (
          <AccountMenu viewer={viewer} onSignOut={onSignOut} />
        ) : (
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-5">
            <a
              href="#how-it-works"
              className="hidden min-h-11 items-center rounded-lg px-2 text-sm text-ink-2 hover:text-brand-ink sm:inline-flex"
            >
              How it works
            </a>
            <a
              href="#questions"
              className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-ink-2 hover:text-brand-ink"
            >
              Questions?
            </a>
          </nav>
        )}
      </div>
    </header>
  );
}

function Avatar({ viewer, size = 28 }: { viewer: Viewer; size?: number }) {
  if (viewer.avatarUrl) {
    return (
      <img
        src={viewer.avatarUrl}
        alt=""
        width={size}
        height={size}
        className="rounded-full bg-surface-3 object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="grid place-items-center rounded-full bg-brand text-xs font-semibold text-white uppercase"
    >
      {viewer.username.slice(0, 1)}
    </span>
  );
}

function AccountMenu({ viewer, onSignOut }: { viewer: Viewer; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    onSignOut();
    try {
      const result = await signOut();
      if (!result.ok) {
        setSignOutError("Couldn't sign out. Please try again.");
        return;
      }
      await router.invalidate();
      setOpen(false);
    } catch {
      setSignOutError("Couldn't sign out. Check your connection and try again.");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-sm font-medium transition-colors hover:bg-surface-2 sm:gap-2"
      >
        <Avatar viewer={viewer} />
        <span className="max-sm:sr-only sm:max-w-40 sm:truncate" title={viewer.username}>
          {viewer.username}
        </span>
        <ChevronDownIcon
          className={cx("size-4 text-ink-3 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute right-0 mt-2 w-64 origin-top-right overflow-hidden rounded-2xl bg-surface p-1.5 shadow-card ring-1 ring-line"
        >
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar viewer={viewer} size={36} />
            <div className="min-w-0">
              <p className="truncate font-medium">{viewer.name}</p>
              <p className="truncate text-sm text-ink-3">
                Connected to Trakt{viewer.vip ? " · VIP" : ""}
              </p>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <a
            href={`https://trakt.tv/users/${encodeURIComponent(viewer.slug)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm hover:bg-surface-2"
          >
            <ExternalIcon className="size-4 text-ink-3" /> Open Trakt profile
          </a>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm text-bad hover:bg-bad-soft disabled:opacity-50"
          >
            <LogOutIcon className="size-4" /> {signingOut ? "Signing out…" : "Sign out"}
          </button>
          {signOutError && (
            <div className="mt-1">
              <Alert>{signOutError}</Alert>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
