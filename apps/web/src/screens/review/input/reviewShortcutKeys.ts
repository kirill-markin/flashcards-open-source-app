import type { ReviewRating } from "../../../../../backend/src/scheduling";

export const reviewRevealShortcutKey = " ";

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
