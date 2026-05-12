"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { DeveloperLogoutButton } from "@/components/developer/logout-button";
import { PortalSwitcher } from "@/components/portal-switcher";

const nav = [
  { href: "/developer", label: "Overview" },
  { href: "/developer/applications", label: "Submissions" },
  { href: "/developer/settings", label: "Settings" },
] as const;

export function DeveloperShell({
  canSwitchToAdmin,
  children,
}: {
  canSwitchToAdmin: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let gPressed = false;
    let timeout: NodeJS.Timeout;
    const shortcuts: Record<string, string> = {
      o: "/developer",
      a: "/developer/applications",
      s: "/developer/settings",
    };

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") {
        return;
      }

      if (event.key === "g") {
        gPressed = true;
        timeout = setTimeout(() => {
          gPressed = false;
        }, 1000);
        return;
      }

      if (gPressed && shortcuts[event.key]) {
        event.preventDefault();
        router.push(shortcuts[event.key]!);
        gPressed = false;
        clearTimeout(timeout);
      }
    };

    window.addEventListener("keydown", handler);

    return () => {
      window.removeEventListener("keydown", handler);
      clearTimeout(timeout);
    };
  }, [router]);

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      <div className="w-52 shrink-0 bg-white flex flex-col">
        <div className="px-3 pb-4 pt-7">
          <Link
            href="/developer"
            className="inline-block"
            title="Potato Chips AI Developer Portal"
          >
            <BrandLogo
              variant="adaptive"
              className="h-auto w-[11rem]"
              priority
              sizes="176px"
            />
          </Link>
          <PortalSwitcher current="developer" canSwitch={canSwitchToAdmin} />
        </div>

        <nav className="flex-1 flex flex-col gap-0.5 px-2 pt-4">
          {nav.map((item) => {
            const active =
              item.href === "/developer"
                ? pathname === "/developer"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-2 py-2 rounded text-[0.94rem] tracking-[-0.01em] transition-colors ${
                  active ? "bg-black text-white font-medium" : "text-muted"
                }`}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-4 pb-5 pt-4">
          <DeveloperLogoutButton className="px-0 py-0 text-[10px] tracking-[0.16em] hover:bg-transparent" />
        </div>
      </div>

      <main className="flex-1 overflow-y-auto bg-white px-6 pb-12 pt-6">{children}</main>
    </div>
  );
}
