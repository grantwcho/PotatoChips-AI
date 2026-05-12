import Link from "next/link";
import { BrandLogo } from "./brand-logo";
import { MarketingNavShell } from "./marketing-nav-shell";

export function NavigationFallback() {
  const logoClass =
    "h-auto w-[clamp(10.2rem,52vw,16rem)] md:w-[clamp(11rem,18vw,16rem)]";

  return (
    <div className="marketing-nav-fallback absolute inset-x-0 top-0 z-50 overflow-hidden border-0 shadow-none outline-none">
      <nav className="marketing-nav-fallback-nav relative border-0 shadow-none outline-none after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-[2px]">
        <div className="marketing-container py-4 sm:py-5">
          <div className="marketing-rail flex items-center justify-between gap-4">
            <Link href="/" className="marketing-logo">
              <span className="marketing-nav-fallback-logo marketing-nav-fallback-logo--home">
                <BrandLogo variant="white" className={logoClass} priority />
              </span>
              <span className="marketing-nav-fallback-logo marketing-nav-fallback-logo--interior">
                <BrandLogo variant="black" className={logoClass} priority />
              </span>
            </Link>

            <div className="hidden items-center justify-end gap-4 text-sm md:flex">
              <Link href="/contact" className="marketing-nav-link">
                Contact Us
              </Link>
            </div>
            <button
              type="button"
              aria-label="Open menu"
              className="inline-flex h-11 w-11 items-center justify-center md:hidden"
              disabled
            >
              <span aria-hidden="true" className="relative h-5 w-8">
                <span className="absolute left-0 top-0 h-[2px] w-full bg-current" />
                <span className="absolute left-0 top-[9px] h-[2px] w-full bg-current" />
                <span className="absolute left-0 top-[18px] h-[2px] w-full bg-current" />
              </span>
            </button>
          </div>
        </div>
      </nav>
    </div>
  );
}

export function Navigation() {
  return <MarketingNavShell />;
}
