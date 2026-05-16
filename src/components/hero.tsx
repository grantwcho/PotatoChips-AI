import Image from "next/image";

import nycImage from "../../assets/images/nyc.png";
import { HeroCopyReveal } from "./hero-copy-reveal";
import { MarketDebateShowcase } from "./market-debate-showcase";
import { OrthogonalitySectionFrame } from "./orthogonality-section-frame";
import { ScrollExpandingCard } from "./scroll-expanding-card";
import { STOCK_COVERAGE_ENABLED } from "@/lib/stocks/coverage-data";

function NycImageGraphic() {
  return (
    <div
      className="nyc-image-frame"
      aria-label="Outline drawing of the New York City skyline."
      role="img"
    >
      <Image
        aria-hidden="true"
        alt=""
        className="nyc-outline-image"
        sizes="(max-width: 768px) 88vw, 720px"
        src={nycImage}
      />
    </div>
  );
}

function UniqueValueSection() {
  return (
    <section className="marketing-scroll-card-stage marketing-scroll-card-stage--usa relative z-10 pt-12 sm:pt-14 lg:pt-16">
      <ScrollExpandingCard className="marketing-orthogonality-section marketing-home-light-section marketing-home-usa-section marketing-panel-light text-black">
        <div className="marketing-container">
          <OrthogonalitySectionFrame className="marketing-orthogonality-panel--stacked">
            <div className="marketing-orthogonality-cell flex min-h-[44rem] flex-col items-center justify-center px-0 py-12 sm:py-16 lg:min-h-[48rem] lg:py-20">
              <div className="marketing-orthogonality-copy-inner w-full max-w-[48rem] px-4 text-center sm:px-7">
                <h2 className="font-sans text-[clamp(2.2rem,4vw,4.35rem)] font-light leading-[1.02] tracking-[0] text-black">
                  Made in the USA
                </h2>
                <p className="mx-auto mt-5 max-w-[50rem] font-display text-[clamp(1.15rem,1.45vw,1.55rem)] font-light not-italic leading-[1.32] tracking-[0] text-black/72">
                  All of our chips are produced in the United States of America
                  in accordance to the CHIPS and Science Act of 2022.
                </p>
              </div>

              <div className="mx-auto mt-12 flex w-full justify-center sm:mt-14">
                <NycImageGraphic />
              </div>
            </div>
          </OrthogonalitySectionFrame>
        </div>
      </ScrollExpandingCard>
    </section>
  );
}

export function Hero() {
  return (
    <>
      <div className="bg-background text-foreground">
        <section className="marketing-home-video-hero">
          <div className="marketing-home-video-hero__frame" aria-hidden="true">
            <video
              autoPlay
              className="marketing-home-video-hero__video"
              loop
              muted
              playsInline
              poster="/videos/merged-poster.jpg"
              preload="auto"
            >
              <source src="/videos/merged.mp4" type="video/mp4" />
            </video>
          </div>

          <div className="marketing-container marketing-home-video-hero__container">
            <div className="marketing-rail marketing-home-video-hero__rail">
              <HeroCopyReveal />
            </div>
          </div>
        </section>
      </div>

      <UniqueValueSection />

      {STOCK_COVERAGE_ENABLED ? <MarketDebateShowcase /> : null}
    </>
  );
}
