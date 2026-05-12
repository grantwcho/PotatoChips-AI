"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type OrthogonalitySectionFrameProps = {
  children: ReactNode;
  className?: string;
};

export function OrthogonalitySectionFrame({
  children,
  className,
}: OrthogonalitySectionFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;

    if (!frame || !("IntersectionObserver" in window)) {
      const frameId = window.requestAnimationFrame(() => setIsVisible(true));

      return () => window.cancelAnimationFrame(frameId);
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frameId = window.requestAnimationFrame(() => setIsVisible(true));

      return () => window.cancelAnimationFrame(frameId);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          return;
        }

        setIsVisible(true);
        observer.disconnect();
      },
      {
        rootMargin: "0px 0px -12% 0px",
        threshold: 0.2,
      },
    );

    observer.observe(frame);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className={`marketing-orthogonality-panel${
        isVisible ? " is-visible" : ""
      }${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}
