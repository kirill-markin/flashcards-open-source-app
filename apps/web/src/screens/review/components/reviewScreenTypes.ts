import type { ReviewRating } from "../../../../../backend/src/scheduling";
import type { Card } from "../../../types";

export type ReviewPaneState = "loading" | "card" | "empty";
export type ReviewPaneEmptyReason = "none" | "nothing-due" | "no-cards";
export type ReviewSubmitState = "idle" | "submitting" | "settled" | "failed";

export type LastSubmittedReview = Readonly<{
  cardId: string;
  rating: ReviewRating;
}>;

export function resolveReviewPaneState(isInitialReviewLoad: boolean, selectedCard: Card | null): ReviewPaneState {
  if (isInitialReviewLoad) {
    return "loading";
  }

  if (selectedCard !== null) {
    return "card";
  }

  return "empty";
}

export function resolveReviewPaneEmptyReason(
  isInitialReviewLoad: boolean,
  selectedCard: Card | null,
  hasCards: boolean,
): ReviewPaneEmptyReason {
  if (isInitialReviewLoad || selectedCard !== null) {
    return "none";
  }

  return hasCards ? "nothing-due" : "no-cards";
}

export function formatReviewSubmitRating(lastSubmittedReview: LastSubmittedReview | null): `${ReviewRating}` | "none" {
  if (lastSubmittedReview === null) {
    return "none";
  }

  return `${lastSubmittedReview.rating}`;
}
