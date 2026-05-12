export type CharacterTextSegment =
  | string
  | {
      className?: string;
      text: string;
    };

export const CHARACTER_REVEAL_STAGGER_MS = 15;
export const CHARACTER_REVEAL_OVERLAP_MS = 100;
export const CHARACTER_REVEAL_LINE_OVERLAP_RATIO = 0.5;

export function segmentText(segment: CharacterTextSegment) {
  return typeof segment === "string" ? segment : segment.text;
}

export function segmentClassName(segment: CharacterTextSegment) {
  return typeof segment === "string" ? undefined : segment.className;
}

export function countRevealCharacters(input: string | CharacterTextSegment[]) {
  const segments = typeof input === "string" ? [input] : input;

  return segments.reduce((count, segment) => {
    return (
      count +
      Array.from(segmentText(segment)).filter(
        (character) => character !== " " && character !== "\n",
      ).length
    );
  }, 0);
}

export function getCharacterRevealBodyDelayMs(
  input: string | CharacterTextSegment[],
) {
  return (
    Math.max(0, countRevealCharacters(input) - 1) *
      CHARACTER_REVEAL_STAGGER_MS +
    CHARACTER_REVEAL_OVERLAP_MS
  );
}
