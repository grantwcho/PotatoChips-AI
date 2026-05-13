"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { CharacterTextReveal } from "./character-text-reveal";
import {
  CHARACTER_REVEAL_LINE_OVERLAP_RATIO,
  CHARACTER_REVEAL_STAGGER_MS,
  countRevealCharacters,
  type CharacterTextSegment,
} from "./character-text-reveal-utils";

const HERO_HEADLINE_SEGMENTS: CharacterTextSegment[] = [
  "People are ",
  { className: "italic", text: "hungry" },
  "\nfor more AI chips.\nWe delivered.",
];
const HERO_BODY_SEGMENTS: CharacterTextSegment[] = [
  "Generations of LLMs and AI hype have ",
  { className: "line-through decoration-current", text: "bubb" },
  "led to this point.",
];
const HERO_HEADLINE_REVEAL_SPEED = 0.5;
const HERO_BODY_CHARACTER_REVEAL_SPEED = 1.5;
const HERO_CHARACTER_REVEAL_DURATION_MS = 200;
const HERO_HEADLINE_STAGGER_MS =
  CHARACTER_REVEAL_STAGGER_MS / HERO_HEADLINE_REVEAL_SPEED;
const HERO_BODY_STAGGER_MS =
  CHARACTER_REVEAL_STAGGER_MS / HERO_BODY_CHARACTER_REVEAL_SPEED;
const HERO_BODY_DELAY_MS =
  countRevealCharacters(HERO_HEADLINE_SEGMENTS) *
  HERO_HEADLINE_STAGGER_MS *
  CHARACTER_REVEAL_LINE_OVERLAP_RATIO;
const HERO_CTA_FALLBACK_DELAY_MS = Math.round(
  HERO_BODY_DELAY_MS +
    Math.max(0, countRevealCharacters(HERO_BODY_SEGMENTS) - 1) *
      HERO_BODY_STAGGER_MS +
    HERO_CHARACTER_REVEAL_DURATION_MS / HERO_BODY_CHARACTER_REVEAL_SPEED,
);

export function HeroCopyReveal() {
  const [ctaDelayMs, setCtaDelayMs] = useState(HERO_CTA_FALLBACK_DELAY_MS);
  const hasCtaStartedRef = useRef(false);

  useEffect(() => {
    hasCtaStartedRef.current = false;
    const timerId = window.setTimeout(() => {
      hasCtaStartedRef.current = true;
    }, ctaDelayMs);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [ctaDelayMs]);

  const syncCtaDelay = useCallback((completeMs: number) => {
    if (hasCtaStartedRef.current) {
      return;
    }

    setCtaDelayMs(Math.round(completeMs));
  }, []);

  return (
    <div className="mx-auto w-full max-w-[58rem] text-center">
      <h1 className="font-google-sans mx-auto w-full max-w-[22rem] text-[1.95rem] font-semibold leading-[0.98] tracking-normal text-balance sm:max-w-[48rem] sm:text-[3.1rem] lg:text-[3.35rem] xl:text-[3.95rem] 2xl:text-[4.6rem]">
        <CharacterTextReveal
          characterSpeed={HERO_HEADLINE_REVEAL_SPEED}
          lineSpeed={HERO_HEADLINE_REVEAL_SPEED}
          segments={HERO_HEADLINE_SEGMENTS}
        />
      </h1>
      <p className="font-google-sans mx-auto mt-7 max-w-[18rem] text-[1.05rem] font-normal leading-[1.38] tracking-normal text-white/66 sm:max-w-[45rem] sm:text-[1.35rem] lg:text-[1.55rem]">
        <CharacterTextReveal
          characterSpeed={HERO_BODY_CHARACTER_REVEAL_SPEED}
          delayMs={HERO_BODY_DELAY_MS}
          onRevealCompleteMsChange={syncCtaDelay}
          segments={HERO_BODY_SEGMENTS}
        />
      </p>
      <div
        className="marketing-fade-up relative z-30 mx-auto mt-7 w-full max-w-[20rem] pointer-events-auto sm:max-w-sm"
        style={{ animationDelay: `${ctaDelayMs}ms` }}
      >
        <Button
          href="/contact"
          className="marketing-hero-button relative z-30 min-w-0 w-full"
        >
          Contact us
        </Button>
      </div>
    </div>
  );
}
