import { parseDueAtMillis } from "../domain/dueAt";
import type { Card } from "../../types";

// Browsers fire any longer setTimeout delay immediately; a clamped timer only recomputes and reschedules.
const maxTimeoutDelayMs: number = 2 ** 31 - 1;
// A timer can fire a moment early; a refresh read before the due time would re-arm for the same card.
const nextDueTimerSlackMs: number = 1000;

/*
 * Counts read while a rating was in flight are repaired by one rescan once ratings pause this long; each
 * rating restarts the wait, so steady rating never rescans the workspace:
 * docs/fsrs-scheduling-logic.md#non-blocking-review
 */
export const reviewCountsRepairDelay: number = 3 * 1000;

export function delayUntilNextDueMillis(nextDueAtMillis: number, nowTimestamp: number): number {
  return Math.min(Math.max(nextDueAtMillis - nowTimestamp, 0) + nextDueTimerSlackMs, maxTimeoutDelayMs);
}

/*
 * In-memory patches a local rating applies instead of rescanning the workspace:
 * docs/fsrs-scheduling-logic.md#non-blocking-review
 * The rated card was due, and a rating always schedules it after the review time.
 */
export function dueCountAfterLocalReview(dueCount: number): number {
  return Math.max(0, dueCount - 1);
}

export function nextDueAtMillisAfterLocalReview(
  nextDueAtMillis: number | null,
  reviewedCard: Card,
  nowTimestamp: number,
): number | null {
  const reviewedDueAtMillis = reviewedCard.dueAt === null ? null : parseDueAtMillis(reviewedCard.dueAt);
  if (reviewedDueAtMillis === null || reviewedDueAtMillis <= nowTimestamp) {
    return nextDueAtMillis;
  }

  return nextDueAtMillis === null ? reviewedDueAtMillis : Math.min(nextDueAtMillis, reviewedDueAtMillis);
}
