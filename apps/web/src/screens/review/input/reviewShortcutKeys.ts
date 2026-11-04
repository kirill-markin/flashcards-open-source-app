import type { ReviewRating } from "../../../../../backend/src/scheduling";

export const reviewRevealShortcutKeys: ReadonlyArray<string> = [" ", "Enter"];

export const reviewRatingShortcutKeys: Readonly<Record<ReviewRating, string>> = {
  0: "1",
  1: "2",
  2: "3",
  3: "4",
};

export const reviewShortcutRatingsByKey: Readonly<Record<string, ReviewRating>> = {
  [reviewRatingShortcutKeys[0]]: 0,
  [reviewRatingShortcutKeys[1]]: 1,
  [reviewRatingShortcutKeys[2]]: 2,
  [reviewRatingShortcutKeys[3]]: 3,
};

export const reviewSpeechShortcutKey = "R";
export const reviewCopyShortcutKey = "C";

// A typed ASCII letter wins (Dvorak, Colemak, Caps Lock); otherwise the physical key position names the letter (non-Latin layouts).
export function reviewShortcutLetter(event: KeyboardEvent): string | null {
  if (/^[a-z]$/i.test(event.key)) {
    return event.key.toUpperCase();
  }

  const physicalKeyMatch = /^Key([A-Z])$/.exec(event.code);
  return physicalKeyMatch?.[1] ?? null;
}
