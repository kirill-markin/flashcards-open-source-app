import { expect, type Locator, type Page } from "@playwright/test";

import {
  trackedClick,
  trackedExpectAttribute,
  trackedFill,
} from "../../live-smoke.actions";
import { externalUiTimeoutMs, localUiTimeoutMs, reviewPostSubmitTimeoutMs } from "../config";
import { primaryNavigationLinkSelector } from "../navigation";
import { runLiveSmokeStep } from "../steps";
import type { LiveSmokeSession } from "../types";

type ReviewPaneState = "loading" | "card" | "empty" | "missing";
type ReviewPaneEmptyReason = "none" | "nothing-due" | "no-cards" | "missing";
type ReviewQueueDueState = "due" | "upcoming" | "missing";
type ReviewSubmitState = "idle" | "submitting" | "settled" | "failed" | "missing";
type ReviewSubmitRating = "0" | "1" | "2" | "3" | "none" | "missing";

type PostReviewObservation = Readonly<{
  currentCardId: string | null;
  lastSubmittedCardId: string | null;
  lastSubmittedRating: ReviewSubmitRating;
  reviewPaneEmptyReason: ReviewPaneEmptyReason;
  reviewPaneState: ReviewPaneState;
  reviewSubmitState: ReviewSubmitState;
  reviewedCardQueueDueState: ReviewQueueDueState;
}>;

export async function runSeededCardReviewFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "verify the seeded card in cards and review it", async () => {
    await assertSeededCardVisibleInCards(session);
    await reviewSeededCardFromQueue(session);
  });
}

async function assertSeededCardVisibleInCards(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  await trackedClick(diagnostics, "open cards navigation for verification", page.locator(primaryNavigationLinkSelector("/cards")).first());
  const searchInput = page.getByTestId("cards-search-input");
  await trackedFill(diagnostics, "clear cards search input", searchInput, "");
  const seededCardRow = page.locator(`[data-testid="cards-row"][data-card-front-text=${JSON.stringify(scenario.seededFrontText)}]`).first();
  await waitForCardVisibleUnlessSyncing(
    page,
    diagnostics,
    `confirm cards list shows ${scenario.seededFrontText}`,
    seededCardRow,
    localUiTimeoutMs,
  );
  await assertMultipleCardNavigation(session);
  await trackedFill(diagnostics, `fill cards search input with ${scenario.seededFrontText}`, searchInput, scenario.seededFrontText);
  await diagnostics.runAction("open the seeded card using its native keyboard link", async () => {
    const rowLink = seededCardRow.getByTestId("cards-row-link");
    await rowLink.focus();
    await expect(rowLink).toBeFocused();
    await rowLink.press("Enter");
  });
  await diagnostics.runAction("confirm the row opens the matching card form", async () => {
    await expect(page.getByTestId("card-form-front-text")).toHaveValue(scenario.seededFrontText);
  });
}

async function assertMultipleCardNavigation(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  const navigationFrontText = `${scenario.seededFrontText} navigation`;
  const navigationBackText = "Temporary navigation answer\nSecond answer line\nThird answer line";
  const navigationCardRow = page.locator(`[data-testid="cards-row"][data-card-front-text=${JSON.stringify(navigationFrontText)}]`);
  const cardsNavigation = page.locator(primaryNavigationLinkSelector("/cards")).first();
  const frontField = page.getByTestId("card-form-front-text");
  const backField = page.getByTestId("card-form-back-text");

  await trackedClick(diagnostics, "open New card to create a second navigation row", page.getByTestId("cards-new-card"));
  await trackedFill(diagnostics, "fill the second navigation card front", frontField, navigationFrontText);
  await trackedFill(diagnostics, "fill a multiline second navigation card back", backField, navigationBackText);
  await trackedClick(diagnostics, "save the second navigation card", page.getByTestId("card-form-save"));
  await diagnostics.runAction("confirm two distinct cards are visible with the new card first", async () => {
    await expect(page.getByTestId("cards-row")).toHaveCount(2);
    await expect(page.getByTestId("cards-row").first()).toHaveAttribute("data-card-front-text", navigationFrontText);
  });

  await trackedClick(diagnostics, "open New card while multiple rows are visible", page.getByTestId("cards-new-card"));
  await diagnostics.runAction("confirm New card opens an empty form", async () => {
    await expect(frontField).toHaveValue("");
    await expect(backField).toHaveValue("");
    await expect(page.getByTestId("card-form-delete")).toHaveCount(0);
  });
  await trackedClick(diagnostics, "return to multiple cards for list controls", cardsNavigation);
  const filterTrigger = page.getByTestId("cards-filter-trigger");
  await trackedClick(diagnostics, "open Filter while multiple rows are visible", filterTrigger);
  await trackedExpectAttribute(diagnostics, "confirm Filter opens without navigating", filterTrigger, "aria-expanded", "true", localUiTimeoutMs);
  await diagnostics.runAction("dismiss Filter with Escape", async () => {
    await page.keyboard.press("Escape");
    await expect(filterTrigger).toHaveAttribute("aria-expanded", "false");
  });

  await diagnostics.runAction("open the first card from non-link row whitespace", async () => {
    const repsCell = navigationCardRow.getByTestId("cards-row-reps-cell");
    await expect(repsCell).toBeVisible();
    const cellBounds = await repsCell.boundingBox();
    if (cellBounds === null) {
      throw new Error("Navigation card repetitions cell has no bounding box");
    }
    await repsCell.click({ position: { x: 4, y: cellBounds.height - 4 } });
    await expect(frontField).toHaveValue(navigationFrontText);
    await expect(backField).toHaveValue(navigationBackText);
  });
  const deleteConfirmation = page.waitForEvent("dialog");
  await Promise.all([
    trackedClick(diagnostics, "delete the temporary navigation card before reviewing", page.getByTestId("card-form-delete")),
    deleteConfirmation.then((dialog) => dialog.accept()),
  ]);
  await diagnostics.runAction("confirm only the seeded review card remains", async () => {
    await expect(page.getByTestId("cards-row")).toHaveCount(1);
    await expect(navigationCardRow).toHaveCount(0);
  });
}

async function reviewSeededCardFromQueue(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  const currentReviewFrontCard = page.getByTestId("review-current-front-card");
  const reviewPane = page.getByTestId("review-pane");
  const reviewedQueueCard = page.locator(
    `[data-testid="review-queue-card"][data-card-front-text=${JSON.stringify(scenario.seededFrontText)}]`,
  ).first();
  await trackedClick(diagnostics, "open review navigation", page.locator(primaryNavigationLinkSelector("/review")).first());
  await trackedExpectAttribute(
    diagnostics,
    `confirm review queue shows ${scenario.seededFrontText}`,
    currentReviewFrontCard,
    "data-card-front-text",
    scenario.seededFrontText,
    localUiTimeoutMs,
  );
  const reviewedCardId = await currentReviewFrontCard.getAttribute("data-card-id");
  if (reviewedCardId === null || reviewedCardId === "") {
    throw new Error(`Review current card id is unavailable for ${scenario.seededFrontText}`);
  }
  await trackedClick(diagnostics, "open review queue for post-review observation", page.getByTestId("review-queue-badge"));
  await trackedClick(diagnostics, "reveal review answer", page.getByTestId("review-reveal-answer"));
  await trackedClick(diagnostics, "submit Good review answer", page.getByTestId("review-rate-good"));
  await session.diagnostics.runAction(`confirm review pane and queue update after reviewing ${scenario.seededFrontText}`, async () => {
    await expect.poll(
      async (): Promise<boolean> => {
        const observation = await observePostReviewState(reviewPane, reviewedQueueCard);
        return isValidPostReviewObservation(observation, reviewedCardId);
      },
      { timeout: reviewPostSubmitTimeoutMs },
    ).toBe(true);
  });
}

async function waitForCardVisibleUnlessSyncing(
  page: Page,
  diagnostics: LiveSmokeSession["diagnostics"],
  actionName: string,
  expectedCard: Locator,
  timeoutMs: number,
): Promise<void> {
  await diagnostics.runAction(actionName, async () => {
    const syncStatus = page.locator(".topbar-sync-status");
    await expect.poll(
      async () => {
        if (await expectedCard.isVisible().catch(() => false)) {
          return "visible";
        }

        if (await syncStatus.first().isVisible().catch(() => false)) {
          return "syncing";
        }

        return "missing";
      },
      { timeout: timeoutMs },
    ).toBe("visible");
  });
}

async function observePostReviewState(
  reviewPane: Locator,
  reviewedQueueCard: Locator,
): Promise<PostReviewObservation> {
  const reviewPaneState = toReviewPaneState(await reviewPane.getAttribute("data-review-pane-state"));
  const reviewPaneEmptyReason = toReviewPaneEmptyReason(await reviewPane.getAttribute("data-review-pane-empty-reason"));
  const currentCardId = toNullableAttributeValue(await reviewPane.getAttribute("data-review-current-card-id"));
  const reviewSubmitState = toReviewSubmitState(await reviewPane.getAttribute("data-review-submit-state"));
  const lastSubmittedCardId = toNullableAttributeValue(await reviewPane.getAttribute("data-review-last-submitted-card-id"));
  const lastSubmittedRating = toReviewSubmitRating(await reviewPane.getAttribute("data-review-last-submitted-rating"));
  const reviewedCardQueueDueState = toReviewQueueDueState(await reviewedQueueCard.getAttribute("data-card-due-state"));

  return {
    currentCardId,
    lastSubmittedCardId,
    lastSubmittedRating,
    reviewPaneEmptyReason,
    reviewPaneState,
    reviewSubmitState,
    reviewedCardQueueDueState,
  };
}

function isValidPostReviewObservation(
  observation: PostReviewObservation,
  reviewedCardId: string,
): boolean {
  if (observation.reviewSubmitState !== "settled") {
    return false;
  }

  if (observation.lastSubmittedCardId !== reviewedCardId) {
    return false;
  }

  if (observation.lastSubmittedRating !== "2") {
    return false;
  }

  if (observation.reviewedCardQueueDueState !== "upcoming") {
    return false;
  }

  if (observation.reviewPaneState === "empty") {
    return observation.reviewPaneEmptyReason === "nothing-due";
  }

  if (observation.reviewPaneState === "card") {
    return observation.reviewPaneEmptyReason === "none"
      && observation.currentCardId !== null
      && observation.currentCardId !== reviewedCardId;
  }

  return false;
}

function toReviewPaneState(value: string | null): ReviewPaneState {
  if (value === "loading" || value === "card" || value === "empty") {
    return value;
  }

  return "missing";
}

function toReviewPaneEmptyReason(value: string | null): ReviewPaneEmptyReason {
  if (value === "none" || value === "nothing-due" || value === "no-cards") {
    return value;
  }

  return "missing";
}

function toReviewQueueDueState(value: string | null): ReviewQueueDueState {
  if (value === "due" || value === "upcoming") {
    return value;
  }

  return "missing";
}

function toReviewSubmitState(value: string | null): ReviewSubmitState {
  if (value === "idle" || value === "submitting" || value === "settled" || value === "failed") {
    return value;
  }

  return "missing";
}

function toReviewSubmitRating(value: string | null): ReviewSubmitRating {
  if (value === "0" || value === "1" || value === "2" || value === "3" || value === "none") {
    return value;
  }

  return "missing";
}

function toNullableAttributeValue(value: string | null): string | null {
  if (value === null || value === "") {
    return null;
  }

  return value;
}
