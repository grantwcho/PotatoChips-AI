"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";

export function MarketingNavShell() {
  const pathname = usePathname();
  const isStockResearchReport = /^\/stocks\/[^/]+\/(?:research|agents)\/[^/]+$/.test(pathname);
  const navSurfaceClass = "bg-black";
  const navSeamCoverClass = "after:bg-black";
  const mobileMenuToneClass = "bg-black text-white";
  const mobileMenuBorderClass = "border-white/[0.14]";
  const mobileMenuMutedClass = "text-white/[0.54]";
  const menuButtonToneClass = "text-white";
  const navItems = [
    { href: "/our-story", label: "Our Story" },
    { href: "/preorder", label: "Pre-order" },
    { href: "/contact", label: "Contact Us" },
  ];
  const [isFloating, setIsFloating] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const lastScrollYRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-marketing-route", "home");
  }, []);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    const updateNavVisibility = () => {
      frameRef.current = null;

      const currentScrollY = window.scrollY;
      const lastScrollY = lastScrollYRef.current;
      const delta = currentScrollY - lastScrollY;

      lastScrollYRef.current = currentScrollY;

      if (currentScrollY <= 8) {
        setIsFloating(false);
        setIsVisible(true);
        return;
      }

      if (delta >= 4) {
        setIsFloating(true);
        setIsVisible(false);
        return;
      }

      if (delta <= -4) {
        setIsFloating(true);
        setIsVisible(true);
      }
    };

    const handleScroll = () => {
      if (frameRef.current !== null) {
        return;
      }

      frameRef.current = window.requestAnimationFrame(updateNavVisibility);
    };

    lastScrollYRef.current = window.scrollY;
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const menuButton = (
    <button
      type="button"
      aria-controls="marketing-mobile-menu"
      aria-expanded={isMenuOpen}
      aria-label={isMenuOpen ? "Close menu" : "Open menu"}
      className={`inline-flex h-11 w-11 items-center justify-center transition-opacity hover:opacity-72 md:hidden ${menuButtonToneClass}`}
      onClick={() => setIsMenuOpen((current) => !current)}
    >
      <span aria-hidden="true" className="relative h-5 w-8">
        <span
          className={`absolute left-0 top-0 h-[2px] w-full bg-current transition-transform duration-200 ${
            isMenuOpen ? "translate-y-[9px] rotate-45" : ""
          }`}
        />
        <span
          className={`absolute left-0 top-[9px] h-[2px] w-full bg-current transition-opacity duration-200 ${
            isMenuOpen ? "opacity-0" : "opacity-100"
          }`}
        />
        <span
          className={`absolute left-0 top-[18px] h-[2px] w-full bg-current transition-transform duration-200 ${
            isMenuOpen ? "-translate-y-[9px] -rotate-45" : ""
          }`}
        />
      </span>
    </button>
  );

  return (
    <>
      <div
        className={`inset-x-0 top-0 z-50 overflow-hidden border-0 shadow-none outline-none transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
          isFloating ? "fixed" : "absolute"
        } ${
          isFloating && !isVisible && !isMenuOpen ? "-translate-y-full" : "translate-y-0"
        } ${navSurfaceClass}`}
      >
        {isStockResearchReport ? (
          <div className="bg-black text-white">
            <div className="marketing-container py-3">
              <div className="marketing-rail">
                <p className="max-w-6xl text-[11px] leading-relaxed text-white/74 sm:text-[12px]">
                  This page is provided for research context only and should not be treated as an
                  instruction, recommendation, or offer.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <nav
          className={`marketing-site-nav marketing-site-nav--home relative border-0 shadow-none outline-none after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] ${navSeamCoverClass}`}
        >
          <div className="marketing-container py-4 sm:py-5">
            <div className="marketing-rail flex items-center justify-between gap-4">
              <Link href="/" className="marketing-logo">
                <BrandLogo
                  variant="white"
                  className="h-auto w-[clamp(10.2rem,52vw,16rem)] md:w-[clamp(11rem,18vw,16rem)]"
                  priority
                />
              </Link>

              <div className="hidden items-center justify-end gap-6 text-sm md:flex">
                {navItems.map((item) => (
                  <Link key={item.href} href={item.href} className="marketing-nav-link">
                    {item.label}
                  </Link>
                ))}
              </div>

              {menuButton}
            </div>
          </div>
        </nav>
      </div>

      {isMenuOpen ? (
        <div
          id="marketing-mobile-menu"
          role="dialog"
          aria-modal="true"
          className={`fixed inset-0 z-[60] md:hidden ${mobileMenuToneClass}`}
        >
          <div className="marketing-container flex min-h-[100svh] flex-col pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
            <div className="flex items-center justify-between gap-4">
              <Link href="/" className="marketing-logo" onClick={() => setIsMenuOpen(false)}>
                <BrandLogo
                  variant="white"
                  className="h-auto w-[clamp(10.2rem,52vw,16rem)]"
                  priority
                />
              </Link>

              {menuButton}
            </div>

            <div className={`mt-12 border-t ${mobileMenuBorderClass}`}>
              {navItems.map((item, index) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group flex items-center justify-between border-b py-6 text-[1.85rem] leading-none tracking-[-0.03em] transition-opacity hover:opacity-70 ${mobileMenuBorderClass}`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  <span>{item.label}</span>
                  <span
                    aria-hidden="true"
                    className={`dashboard-numeric text-sm tracking-normal ${mobileMenuMutedClass}`}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
