"use client";

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

type ScrollExpandingCardStyle = CSSProperties & {
  "--scroll-card-inset": string;
  "--scroll-card-progress": string;
};

type ScrollExpandingCardProps = {
  children: ReactNode;
  className?: string;
};

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function ScrollExpandingCard({
  children,
  className,
}: ScrollExpandingCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const card = cardRef.current;

    if (!card) {
      return;
    }

    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    let frameId = 0;

    const updateProgress = () => {
      frameId = 0;

      if (reducedMotionQuery.matches) {
        card.style.setProperty("--scroll-card-inset", "0px");
        card.style.setProperty("--scroll-card-progress", "1");
        return;
      }

      const viewportHeight = window.innerHeight || 1;
      const rect = card.getBoundingClientRect();
      const startTop = viewportHeight * 0.72;
      const endTop = viewportHeight * 0.02;
      const progress = clamp((startTop - rect.top) / (startTop - endTop));
      const inset = (1 - progress) * window.innerWidth * 0.025;

      card.style.setProperty("--scroll-card-inset", `${inset.toFixed(2)}px`);
      card.style.setProperty("--scroll-card-progress", progress.toFixed(4));
    };

    const requestUpdate = () => {
      if (frameId !== 0) {
        return;
      }

      frameId = window.requestAnimationFrame(updateProgress);
    };

    updateProgress();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    reducedMotionQuery.addEventListener("change", requestUpdate);

    return () => {
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      reducedMotionQuery.removeEventListener("change", requestUpdate);
    };
  }, []);

  return (
    <div
      className={`marketing-scroll-expanding-card${
        className ? ` ${className}` : ""
      }`}
      ref={cardRef}
      style={
        {
          "--scroll-card-inset": "2.5vw",
          "--scroll-card-progress": "0",
        } as ScrollExpandingCardStyle
      }
    >
      {children}
    </div>
  );
}
