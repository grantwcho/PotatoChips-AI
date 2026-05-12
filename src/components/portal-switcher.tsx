"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type PortalKey = "admin" | "developer";

const portals: Record<PortalKey, { href: string; label: string }> = {
  admin: {
    href: "/dashboard/submissions",
    label: "Admin Portal",
  },
  developer: {
    href: "/developer",
    label: "Developer Portal",
  },
};

type PortalSwitcherProps = {
  canSwitch: boolean;
  current: PortalKey;
};

export function PortalSwitcher({ canSwitch, current }: PortalSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const currentPortal = portals[current];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!canSwitch) {
    return (
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
        {currentPortal.label}
      </p>
    );
  }

  return (
    <div ref={rootRef} className="relative mt-3">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex w-full items-center justify-between gap-3 text-left text-[10px] font-semibold uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        <span>{currentPortal.label}</span>
        <span
          aria-hidden="true"
          className={`mt-0.5 h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-current transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-40 mt-3 border border-border bg-background p-1 shadow-[0_18px_48px_rgba(0,0,0,0.14)]"
        >
          {(Object.keys(portals) as PortalKey[]).map((portalKey) => {
            const portal = portals[portalKey];
            const isCurrent = portalKey === current;
            const className = `block w-full px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.14em] transition-colors ${
              isCurrent
                ? "bg-foreground text-background"
                : "text-muted hover:bg-neutral-100 hover:text-foreground"
            }`;

            if (isCurrent) {
              return (
                <span
                  key={portalKey}
                  role="menuitem"
                  aria-current="page"
                  className={className}
                >
                  {portal.label}
                </span>
              );
            }

            return (
              <Link
                key={portalKey}
                href={portal.href}
                role="menuitem"
                className={className}
                onClick={() => setIsOpen(false)}
              >
                {portal.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
