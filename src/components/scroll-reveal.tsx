"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { CharacterTextReveal } from "@/components/character-text-reveal";
import type { CharacterTextSegment } from "@/components/character-text-reveal-utils";

type ScrollRevealOptions = {
  rootMargin?: string;
  threshold?: number;
};

type ScrollFadeInProps = ScrollRevealOptions & {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

type ScrollCharacterTextRevealProps = ScrollRevealOptions & {
  characterSpeed?: number;
  className?: string;
  delayMs?: number;
  lineSpeed?: number;
  segments?: CharacterTextSegment[];
  text?: string;
};

function useRevealOnView<TElement extends Element>({
  rootMargin = "0px 0px -12% 0px",
  threshold = 0.12,
}: ScrollRevealOptions = {}) {
  const ref = useRef<TElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (!element || isVisible) {
      return;
    }

    const Observer = window.IntersectionObserver;

    if (!Observer) {
      const frameId = globalThis.requestAnimationFrame(() => {
        setIsVisible(true);
      });

      return () => {
        globalThis.cancelAnimationFrame(frameId);
      };
    }

    const observer = new Observer(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }

        setIsVisible(true);
        observer.disconnect();
      },
      { rootMargin, threshold },
    );
    const revealIfAlreadyInView = () => {
      const rect = element.getBoundingClientRect();
      const viewportHeight =
        window.innerHeight || document.documentElement.clientHeight;
      const viewportRevealLine = viewportHeight * (1 - threshold);

      if (rect.top > viewportRevealLine || rect.bottom < 0) {
        return;
      }

      setIsVisible(true);
      observer.disconnect();
    };
    const frameId = globalThis.requestAnimationFrame(revealIfAlreadyInView);

    observer.observe(element);

    return () => {
      globalThis.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [isVisible, rootMargin, threshold]);

  return { isVisible, ref };
}

export function ScrollFadeIn({
  children,
  className,
  rootMargin,
  style,
  threshold,
}: ScrollFadeInProps) {
  const { isVisible, ref } = useRevealOnView<HTMLDivElement>({
    rootMargin,
    threshold,
  });
  const revealClassName = [
    "marketing-scroll-fade",
    isVisible ? "is-visible" : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={revealClassName} ref={ref} style={style}>
      {children}
    </div>
  );
}

export function ScrollCharacterTextReveal({
  characterSpeed,
  className,
  delayMs,
  lineSpeed,
  rootMargin,
  segments,
  text,
  threshold,
}: ScrollCharacterTextRevealProps) {
  const { isVisible, ref } = useRevealOnView<HTMLSpanElement>({
    rootMargin,
    threshold,
  });

  return (
    <span className={className} ref={ref}>
      <CharacterTextReveal
        active={isVisible}
        characterSpeed={characterSpeed}
        delayMs={delayMs}
        lineSpeed={lineSpeed}
        segments={segments}
        text={text}
      />
    </span>
  );
}
