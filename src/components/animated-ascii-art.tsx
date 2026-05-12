"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const ASCII_TYPING_INTERVAL_MS = 14;
const ASCII_TYPING_CHUNK_SIZE = 32;
const ASCII_HOVER_RADIUS_X = 3.8;
const ASCII_HOVER_RADIUS_Y = 1.45;

const ASCII_INVERT_MAP: Record<string, string> = {
  ".": ":",
  ":": ".",
  ";": "+",
  "+": ";",
  x: "X",
  X: "x",
  $: "&",
  "&": "$",
};

function distortAsciiCharacter(char: string) {
  return ASCII_INVERT_MAP[char] ?? char;
}

export function AnimatedAsciiArt({
  art,
  className,
}: {
  art: string;
  className?: string;
}) {
  const normalizedArt = useMemo(() => {
    const trimmed = art.replace(/^\n/, "").replace(/\n$/, "");
    const lines = trimmed.split("\n");
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
    const sharedIndent = nonEmptyLines.reduce((smallestIndent, line) => {
      const leadingWhitespace = line.match(/^ */)?.[0].length ?? 0;

      return Math.min(smallestIndent, leadingWhitespace);
    }, Number.POSITIVE_INFINITY);

    if (!Number.isFinite(sharedIndent) || sharedIndent <= 0) {
      return trimmed;
    }

    return lines
      .map((line) => (line.length >= sharedIndent ? line.slice(sharedIndent) : line))
      .join("\n");
  }, [art]);
  const artLines = useMemo(() => normalizedArt.split("\n"), [normalizedArt]);
  const maxLineLength = useMemo(
    () => artLines.reduce((longest, line) => Math.max(longest, line.length), 0),
    [artLines]
  );
  const [visibleChars, setVisibleChars] = useState(0);
  const [hoverCell, setHoverCell] = useState<{ row: number; col: number } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (prefersReducedMotion) {
      const frame = window.requestAnimationFrame(() => {
        setVisibleChars(normalizedArt.length);
      });

      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    let currentChars = 0;
    const timer = window.setInterval(() => {
      currentChars = Math.min(
        normalizedArt.length,
        currentChars + ASCII_TYPING_CHUNK_SIZE
      );
      setVisibleChars(currentChars);

      if (currentChars >= normalizedArt.length) {
        window.clearInterval(timer);
      }
    }, ASCII_TYPING_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [normalizedArt]);

  const displayedArt = useMemo(() => {
    const visibleArt = normalizedArt.slice(0, visibleChars);

    if (!hoverCell) {
      return visibleArt;
    }

    const visibleLines = visibleArt.split("\n");

    return visibleLines
      .map((line, row) =>
        Array.from(line, (char, col) => {
          if (char === " ") {
            return char;
          }

          const normalizedDx = (col - hoverCell.col) / ASCII_HOVER_RADIUS_X;
          const normalizedDy = (row - hoverCell.row) / ASCII_HOVER_RADIUS_Y;
          const distance = normalizedDx * normalizedDx + normalizedDy * normalizedDy;

          return distance <= 1 ? distortAsciiCharacter(char) : char;
        }).join("")
      )
      .join("\n");
  }, [hoverCell, normalizedArt, visibleChars]);

  function updateHoverCell(clientX: number, clientY: number) {
    const frame = frameRef.current;

    if (!frame || artLines.length === 0 || maxLineLength === 0) {
      return;
    }

    const bounds = frame.getBoundingClientRect();

    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    const row = Math.max(
      0,
      Math.min(
        artLines.length - 1,
        Math.floor(((clientY - bounds.top) / bounds.height) * artLines.length)
      )
    );
    const col = Math.max(
      0,
      Math.min(
        maxLineLength - 1,
        Math.floor(((clientX - bounds.left) / bounds.width) * maxLineLength)
      )
    );

    setHoverCell((currentCell) =>
      currentCell && currentCell.row === row && currentCell.col === col
        ? currentCell
        : { row, col }
    );
  }

  return (
    <div
      ref={frameRef}
      className="relative mx-auto w-fit"
      aria-hidden="true"
      onPointerLeave={() => setHoverCell(null)}
      onPointerMove={(event) => updateHoverCell(event.clientX, event.clientY)}
    >
      <pre className={`animated-ascii-art invisible ${className ?? ""}`}>{normalizedArt}</pre>
      <pre className={`animated-ascii-art absolute inset-0 ${className ?? ""}`}>
        {displayedArt}
        <span aria-hidden="true" className="animated-ascii-cursor">
          |
        </span>
      </pre>
    </div>
  );
}
