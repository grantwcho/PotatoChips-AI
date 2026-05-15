import Image from "next/image";
import taiwanImage from "../../assets/images/taiwan.png";
import { HeroCopyReveal } from "./hero-copy-reveal";
import { MarketDebateShowcase } from "./market-debate-showcase";
import { OrthogonalitySectionFrame } from "./orthogonality-section-frame";
import { RecipeChatTranscript } from "./recipe-chat-transcript";
import { ScrollExpandingCard } from "./scroll-expanding-card";
import { STOCK_COVERAGE_ENABLED } from "@/lib/stocks/coverage-data";

function TaiwanImageGraphic() {
  return (
    <div
      className="taiwan-image-frame"
      aria-label="Outline map of Taiwan."
      role="img"
    >
      <svg
        aria-hidden="true"
        className="taiwan-draw-layer"
        viewBox="0 0 930 620"
      >
        <path
          className="taiwan-draw-layer__path"
          d="M535 60 L522 68 L511.5 84 L462.5 108 L448.5 140 L415.5 180 L345 300 L347 332 L331.5 372 L333.5 380 L351 396 L355 420 L372 460 L417.5 492 L430.5 524 L425.5 532 L438.5 548 L453.5 548 L454 500 L466.5 460 L507 412 L507 404 L523 380 L540.5 324 L556 236 L583 180 L577.5 132 L601.5 108 L586.5 92 L535 60 Z"
          fill="none"
          pathLength={1400}
        />
      </svg>
      <Image
        src={taiwanImage}
        alt="Outline map of Taiwan."
        className="taiwan-image"
        sizes="(max-width: 768px) 82vw, 620px"
      />
    </div>
  );
}

function UniqueValueSection() {
  return (
    <section className="marketing-scroll-card-stage marketing-scroll-card-stage--taiwan relative z-10 pt-12 sm:pt-14 lg:pt-16">
      <ScrollExpandingCard className="marketing-orthogonality-section marketing-home-light-section marketing-home-taiwan-section marketing-panel-light text-black">
        <div className="marketing-container">
          <OrthogonalitySectionFrame className="marketing-orthogonality-panel--stacked">
            <div className="marketing-orthogonality-cell flex min-h-[44rem] flex-col items-center justify-center px-0 py-12 sm:py-16 lg:min-h-[48rem] lg:py-20">
              <div className="marketing-orthogonality-copy-inner w-full max-w-[48rem] px-4 text-center sm:px-7">
                <h2 className="font-sans text-[clamp(2.2rem,4vw,4.35rem)] font-light leading-[1.02] tracking-[-0.04em] text-black">
                  Made in Taiwan.
                </h2>
                <p className="mx-auto mt-5 max-w-[50rem] font-display text-[clamp(1.15rem,1.45vw,1.55rem)] font-light not-italic leading-[1.32] tracking-[-0.01em] text-black/72">
                  The world depends on Taiwan for their chips. We decided that
                  we should too.
                </p>
              </div>

              <div className="mx-auto mt-12 flex w-full justify-center sm:mt-14">
                <TaiwanImageGraphic />
              </div>
            </div>
          </OrthogonalitySectionFrame>
        </div>
      </ScrollExpandingCard>
    </section>
  );
}

function OrthogonalitySection() {
  return (
    <section className="marketing-scroll-card-stage marketing-scroll-card-stage--chat relative z-10 pt-12 sm:pt-14 lg:pt-16">
      <ScrollExpandingCard className="marketing-orthogonality-section marketing-home-light-section marketing-panel-light text-black">
        <div className="marketing-container">
          <OrthogonalitySectionFrame className="marketing-orthogonality-panel--chat">
            <RecipeChatTranscript />
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

      <OrthogonalitySection />
      <UniqueValueSection />

      {STOCK_COVERAGE_ENABLED ? <MarketDebateShowcase /> : null}
    </>
  );
}
