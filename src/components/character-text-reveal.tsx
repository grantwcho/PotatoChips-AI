"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  CHARACTER_REVEAL_LINE_OVERLAP_RATIO,
  CHARACTER_REVEAL_STAGGER_MS,
  segmentClassName,
  segmentText,
  type CharacterTextSegment,
} from "./character-text-reveal-utils";

const CHARACTER_REVEAL_DURATION_MS = 200;
const LINE_REVEAL_DURATION_MS = 640;
const MINIMUM_REVEAL_SPEED = 0.1;
const WORD_TOP_TOLERANCE_PX = 2;

type CharacterRevealStyle = CSSProperties & {
  "--character-reveal-delay": string;
  "--character-reveal-duration": string;
};

type LineRevealStyle = CSSProperties & {
  "--line-reveal-delay": string;
  "--line-reveal-duration": string;
};

type CharacterTextRevealProps = {
  active?: boolean;
  characterSpeed?: number;
  className?: string;
  delayMs?: number;
  lineSpeed?: number;
  onRevealCompleteMsChange?: (completeMs: number) => void;
  segments?: CharacterTextSegment[];
  text?: string;
};

type CharacterPart = {
  character: string;
  characterIndex: number;
  className?: string;
};

type WordToken = {
  firstCharacterIndex: number;
  id: number;
  parts: CharacterPart[];
  type: "word";
};

type SpaceToken = {
  id: string;
  type: "space";
};

type BreakToken = {
  id: string;
  type: "break";
};

type RevealToken = WordToken | SpaceToken | BreakToken;

type RevealLine = {
  firstCharacterIndex: number;
  id: string;
  left: number;
  top: number;
  words: WordToken[];
};

function normalizeSegments({
  segments,
  text,
}: Pick<CharacterTextRevealProps, "segments" | "text">) {
  if (segments) {
    return segments;
  }

  return [text ?? ""];
}

function durationForSpeed(durationMs: number, speed: number) {
  return durationMs / Math.max(speed, MINIMUM_REVEAL_SPEED);
}

function buildRevealContent(segments: CharacterTextSegment[]) {
  const tokens: RevealToken[] = [];
  const words: WordToken[] = [];
  let currentWord: CharacterPart[] = [];
  let characterIndex = 0;
  let tokenIndex = 0;
  let wordIndex = 0;

  function flushWord() {
    if (currentWord.length === 0) {
      return;
    }

    const word: WordToken = {
      firstCharacterIndex: currentWord[0]?.characterIndex ?? 0,
      id: wordIndex,
      parts: currentWord,
      type: "word",
    };
    tokens.push(word);
    words.push(word);
    currentWord = [];
    wordIndex += 1;
  }

  segments.forEach((segment) => {
    const perSegmentClassName = segmentClassName(segment);

    Array.from(segmentText(segment)).forEach((character) => {
      if (character === " ") {
        flushWord();
        tokens.push({ id: `space-${tokenIndex}`, type: "space" });
        tokenIndex += 1;
        return;
      }

      if (character === "\n") {
        flushWord();
        tokens.push({ id: `break-${tokenIndex}`, type: "break" });
        tokenIndex += 1;
        return;
      }

      currentWord.push({
        character,
        characterIndex,
        className: perSegmentClassName,
      });
      characterIndex += 1;
    });
  });
  flushWord();

  return {
    accessibleText: segments.map(segmentText).join(""),
    tokens,
    words,
  };
}

export function CharacterTextReveal({
  active = true,
  characterSpeed = 1,
  className,
  delayMs = 0,
  lineSpeed = 1,
  onRevealCompleteMsChange,
  segments,
  text,
}: CharacterTextRevealProps) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const normalizedSegments = useMemo(
    () => normalizeSegments({ segments, text }),
    [segments, text],
  );
  const { accessibleText, tokens, words } = useMemo(
    () => buildRevealContent(normalizedSegments),
    [normalizedSegments],
  );
  const wordById = useMemo(() => {
    return new Map(words.map((word) => [word.id, word]));
  }, [words]);
  const [lines, setLines] = useState<RevealLine[]>([]);

  const measureLines = useCallback(() => {
    const measureElement = measureRef.current;
    const rootElement = rootRef.current;

    if (!measureElement || !rootElement) {
      return;
    }

    const rootRect = rootElement.getBoundingClientRect();
    const wordElements = Array.from(
      measureElement.querySelectorAll<HTMLElement>(
        "[data-character-reveal-word]",
      ),
    );
    const rows: Array<{
      top: number;
      words: Array<WordToken & { left: number; top: number }>;
    }> = [];

    wordElements.forEach((element) => {
      const wordId = Number(element.dataset.characterRevealWord);
      const word = wordById.get(wordId);

      if (!word) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const measuredWord = {
        ...word,
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
      };
      const existingRow = rows.find(
        (row) => Math.abs(row.top - measuredWord.top) <= WORD_TOP_TOLERANCE_PX,
      );

      if (existingRow) {
        existingRow.words.push(measuredWord);
        existingRow.top = Math.min(existingRow.top, measuredWord.top);
        return;
      }

      rows.push({
        top: measuredWord.top,
        words: [measuredWord],
      });
    });

    setLines(
      rows
        .map((row, rowIndex) => {
          const lineWords = row.words.sort((a, b) => a.left - b.left);
          const firstWord = lineWords[0];

          return {
            firstCharacterIndex: firstWord?.firstCharacterIndex ?? 0,
            id: `${rowIndex}-${firstWord?.id ?? 0}`,
            left: Math.min(...lineWords.map((word) => word.left)),
            top: Math.min(...lineWords.map((word) => word.top)),
            words: lineWords,
          };
        })
        .sort((a, b) => a.top - b.top),
    );
  }, [wordById]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(measureLines);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [measureLines]);

  useEffect(() => {
    let isCancelled = false;

    window.addEventListener("resize", measureLines);
    void document.fonts?.ready.then(() => {
      if (!isCancelled) {
        measureLines();
      }
    });

    return () => {
      isCancelled = true;
      window.removeEventListener("resize", measureLines);
    };
  }, [measureLines]);

  const rootClassName = [
    "marketing-character-reveal",
    !active ? "marketing-character-reveal--paused" : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const characterStaggerMs = durationForSpeed(
    CHARACTER_REVEAL_STAGGER_MS,
    characterSpeed,
  );
  const characterDurationMs = durationForSpeed(
    CHARACTER_REVEAL_DURATION_MS,
    characterSpeed,
  );
  const lineDurationMs = durationForSpeed(LINE_REVEAL_DURATION_MS, lineSpeed);
  const scheduledLines = useMemo(() => {
    const lineMetrics = lines.map((line) => {
      const characterIndices = line.words.flatMap((word) =>
        word.parts.map((part) => part.characterIndex),
      );

      return {
        characterCount: characterIndices.length,
        firstCharacterIndex:
          characterIndices.length > 0
            ? Math.min(...characterIndices)
            : line.firstCharacterIndex,
      };
    });
    const lineDelays = lineMetrics.reduce<number[]>((delays, _metric, index) => {
      if (index === 0) {
        return [delayMs];
      }

      const previousDelay = delays[index - 1] ?? delayMs;
      const previousCharacterCount = lineMetrics[index - 1]?.characterCount ?? 0;
      const nextDelay =
        previousDelay +
        previousCharacterCount *
          characterStaggerMs *
          CHARACTER_REVEAL_LINE_OVERLAP_RATIO;

      return [...delays, nextDelay];
    }, []);

    return lines.map((line, index) => ({
      ...line,
      firstCharacterIndex:
        lineMetrics[index]?.firstCharacterIndex ?? line.firstCharacterIndex,
      revealDelayMs: lineDelays[index] ?? delayMs,
    }));
  }, [characterStaggerMs, delayMs, lines]);
  const revealCompleteMs = useMemo(() => {
    if (scheduledLines.length === 0) {
      return null;
    }

    return scheduledLines.reduce((completeMs, line) => {
      const characterOffsets = line.words.flatMap((word) =>
        word.parts.map(
          (part) => part.characterIndex - line.firstCharacterIndex,
        ),
      );
      const finalCharacterOffset =
        characterOffsets.length > 0 ? Math.max(...characterOffsets) : 0;
      const lineCompleteMs =
        line.revealDelayMs +
        finalCharacterOffset * characterStaggerMs +
        characterDurationMs;

      return Math.max(completeMs, lineCompleteMs);
    }, 0);
  }, [characterDurationMs, characterStaggerMs, scheduledLines]);

  useEffect(() => {
    if (revealCompleteMs === null) {
      return;
    }

    onRevealCompleteMsChange?.(revealCompleteMs);
  }, [onRevealCompleteMsChange, revealCompleteMs]);

  return (
    <span
      aria-label={accessibleText}
      className={rootClassName}
      ref={rootRef}
      role="text"
    >
      <span
        aria-hidden="true"
        className="marketing-character-reveal__measure-layer"
        ref={measureRef}
      >
        {tokens.map((token) => {
          if (token.type === "space") {
            return <Fragment key={token.id}> </Fragment>;
          }

          if (token.type === "break") {
            return <br key={token.id} />;
          }

          return (
            <span
              className="marketing-character-reveal__measure-word"
              data-character-reveal-word={token.id}
              key={`measure-word-${token.id}`}
            >
              {token.parts.map((part) => (
                <span
                  className={part.className}
                  key={`measure-character-${part.characterIndex}`}
                >
                  {part.character}
                </span>
              ))}
            </span>
          );
        })}
      </span>
      <span aria-hidden="true" className="marketing-character-reveal__line-layer">
        {scheduledLines.map((line) => {
          const lineStyle: LineRevealStyle = {
            "--line-reveal-delay": `${line.revealDelayMs}ms`,
            "--line-reveal-duration": `${lineDurationMs}ms`,
            left: `${line.left}px`,
            top: `${line.top}px`,
          };

          return (
            <span
              className="marketing-character-reveal__line"
              key={line.id}
              style={lineStyle}
            >
              {line.words.map((word, wordIndex) => (
                <Fragment key={`line-word-fragment-${line.id}-${word.id}`}>
                  {wordIndex > 0 ? " " : null}
                  <span className="marketing-character-reveal__line-word">
                    {word.parts.map((part) => {
                      const style: CharacterRevealStyle = {
                        "--character-reveal-delay": `${
                          line.revealDelayMs +
                          (part.characterIndex - line.firstCharacterIndex) *
                            characterStaggerMs
                        }ms`,
                        "--character-reveal-duration": `${characterDurationMs}ms`,
                      };
                      const spanClassName = [
                        "marketing-character-reveal__char",
                        part.className,
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <span
                          className={spanClassName}
                          key={`line-character-${part.characterIndex}`}
                          style={style}
                        >
                          {part.character}
                        </span>
                      );
                    })}
                  </span>
                </Fragment>
              ))}
            </span>
          );
        })}
      </span>
    </span>
  );
}
