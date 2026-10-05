import { useRouter } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import type { Viewer } from "@/lib/types";
import { signOut } from "@/server/functions";
import { ChevronDownIcon, ExternalIcon, LogOutIcon, LogoMark } from "./icons";
import { cx } from "./ui";

export function SiteHeader({
  viewer,
  onSignOut,
}: {
  viewer: Viewer | null;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5 rounded-lg font-semibold tracking-tight">
          <LogoMark className="h-3.5 w-9" />
          <span>
            Letterboxd <span className="text-ink-3">→</span> Trakt
          </span>
        </a>
        {viewer && <AccountMenu viewer={viewer} onSignOut={onSignOut} />}
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
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSignOut = async () => {
    setSigningOut(true);
    onSignOut();
    try {
      await signOut();
    } finally {
      await router.invalidate();
      setSigningOut(false);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-full py-1 pr-2.5 pl-1 text-sm font-medium hover:bg-surface-2"
      >
        <Avatar viewer={viewer} />
        <span className="max-w-[10rem] truncate">{viewer.username}</span>
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
            className="flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm hover:bg-surface-2"
          >
            <ExternalIcon className="size-4 text-ink-3" /> Open Trakt profile
          </a>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm text-bad hover:bg-bad-soft disabled:opacity-50"
          >
            <LogOutIcon className="size-4" /> {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
