import Link from "next/link";
import { BrandLogo } from "./brand-logo";

const FOOTER_SOCIAL_ENABLED = false;

export function Footer() {
  return (
    <footer className="bg-background">
      <div className="marketing-container py-16">
        <div className="marketing-rail">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
            <div>
              <Link href="/" className="marketing-logo">
                <BrandLogo
                  variant="white"
                  className="h-auto w-[clamp(11rem,18vw,16rem)]"
                  sizes="(max-width: 768px) 176px, 260px"
                />
              </Link>
            </div>
            <div className="grid gap-10 sm:grid-cols-2">
              <div>
                <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
                  Actions
                </p>
                <div className="flex flex-col items-start gap-4 text-sm">
                  <Link href="/contact" className="marketing-nav-link">
                    Contact Us
                  </Link>
                </div>
              </div>
              {FOOTER_SOCIAL_ENABLED ? (
                <div>
                  <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
                    Social
                  </p>
                  <div className="flex flex-col items-start gap-4 text-sm">
                    <Link
                      href="https://discord.gg/cz3Uq2Q2C"
                      className="marketing-nav-link"
                    >
                      Join Discord
                    </Link>
                  </div>
                </div>
              ) : null}
              <div>
                <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
                  Company
                </p>
                <div className="flex flex-col items-start gap-4 text-sm">
                  <Link href="/privacy-policy" className="marketing-nav-link">
                    Privacy Policy
                  </Link>
                  <Link href="/terms-of-service" className="marketing-nav-link">
                    Terms of Service
                  </Link>
                  <Link href="/disclosures" className="marketing-nav-link">
                    Disclosures
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-14 border-t border-border/70 pt-8">
            <p className="max-w-3xl text-xs leading-relaxed text-muted">
              Potato Chips AI LLC is an AI-themed potato chips brand. Product
              availability, ingredients, nutrition information, and packaging
              may change; always review the product label before consuming.
            </p>
            <p className="mt-4 text-xs text-muted">
              &copy; 2026 Potato Chips AI LLC. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
