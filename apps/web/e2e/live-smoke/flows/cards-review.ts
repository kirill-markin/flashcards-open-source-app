import { expect, type Locator, type Page } from "@playwright/test";

import {
  trackedClick,
  trackedExpectAttribute,
  trackedExpectVisible,
  trackedFill,
} from "../../live-smoke.actions";
import { externalUiTimeoutMs, localUiTimeoutMs } from "../config";
import { runLiveSmokeStep } from "../steps";
import type { LiveSmokeSession } from "../types";

type ReviewPaneState = "loading" | "card" | "empty" | "missing";
type ReviewPaneEmptyReason = "none" | "nothing-due" | "no-cards" | "missing";
type ReviewQueueDueState = "due" | "upcoming" | "missing";

type PostReviewObservation = Readonly<{
  currentFrontText: string | null;
  reviewPaneEmptyReason: ReviewPaneEmptyReason;
  reviewPaneState: ReviewPaneState;
  reviewedCardQueueDueState: ReviewQueueDueState;
}>;

export async function runManualCardReviewFlow(session: LiveSmokeSession): Promise<void> {
  await runLiveSmokeStep(session, "create one manual card", async () => {
    await createManualCard(session);
  });

  await runLiveSmokeStep(session, "verify the manual card in cards and review it", async () => {
    await assertCardVisibleInCards(session);
    await reviewCardFromQueue(session);
  });
}

async function createManualCard(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  await trackedClick(diagnostics, "open cards navigation", page.locator('nav.nav a[href="/cards"]').first());
  await trackedClick(diagnostics, "open new card screen", page.getByTestId("cards-new-card"));
  await trackedFill(diagnostics, `fill card front text ${scenario.manualFrontText}`, page.getByTestId("card-form-front-text"), scenario.manualFrontText);
  await trackedFill(diagnostics, `fill card back text ${scenario.manualBackText}`, page.getByTestId("card-form-back-text"), scenario.manualBackText);
  await trackedClick(diagnostics, "submit manual card", page.getByTestId("card-form-save"));
  await trackedExpectVisible(
    diagnostics,
    "confirm cards screen is visible after manual card save",
    page.getByTestId("cards-screen"),
    externalUiTimeoutMs,
  );
}

async function assertCardVisibleInCards(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  await trackedClick(diagnostics, "open cards navigation for verification", page.locator('nav.nav a[href="/cards"]').first());
  const searchInput = page.getByTestId("cards-search-input");
  await trackedFill(diagnostics, "clear cards search input", searchInput, "");
  await trackedFill(diagnostics, `fill cards search input with ${scenario.manualFrontText}`, searchInput, scenario.manualFrontText);
  await waitForCardVisibleUnlessSyncing(
    page,
    diagnostics,
    `confirm cards list shows ${scenario.manualFrontText}`,
    page.locator(`[data-testid="cards-row"][data-card-front-text=${JSON.stringify(scenario.manualFrontText)}]`).first(),
    localUiTimeoutMs,
  );
}

async function reviewCardFromQueue(session: LiveSmokeSession): Promise<void> {
  const { page, diagnostics, scenario } = session;
  const currentReviewFrontCard = page.getByTestId("review-current-front-card");
  const reviewPane = page.getByTestId("review-pane");
  const reviewedQueueCard = page.locator(
    `[data-testid="review-queue-card"][data-card-front-text=${JSON.stringify(scenario.manualFrontText)}]`,
  ).first();
  await trackedClick(diagnostics, "open review navigation", page.locator('nav.nav a[href="/review"]').first());
  await trackedExpectAttribute(
    diagnostics,
    `confirm review queue shows ${scenario.manualFrontText}`,
    currentReviewFrontCard,
    "data-card-front-text",
    scenario.manualFrontText,
    localUiTimeoutMs,
  );
  await trackedClick(diagnostics, "reveal review answer", page.getByTestId("review-reveal-answer"));
  await trackedClick(diagnostics, "submit Good review answer", page.getByTestId("review-rate-good"));
  await session.diagnostics.runAction(`confirm review pane and queue update after reviewing ${scenario.manualFrontText}`, async () => {
    await expect.poll(
      async (): Promise<boolean> => {
        const observation = await observePostReviewState(reviewPane, currentReviewFrontCard, reviewedQueueCard);
        return isValidPostReviewObservation(observation, scenario.manualFrontText);
      },
      { timeout: localUiTimeoutMs },
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
  currentReviewFrontCard: Locator,
  reviewedQueueCard: Locator,
): Promise<PostReviewObservation> {
  const reviewPaneState = toReviewPaneState(await reviewPane.getAttribute("data-review-pane-state"));
  const reviewPaneEmptyReason = toReviewPaneEmptyReason(await reviewPane.getAttribute("data-review-pane-empty-reason"));
  const reviewedCardQueueDueState = toReviewQueueDueState(await reviewedQueueCard.getAttribute("data-card-due-state"));
  const currentFrontText = reviewPaneState === "card"
    ? await currentReviewFrontCard.getAttribute("data-card-front-text")
    : null;

  return {
    currentFrontText,
    reviewPaneEmptyReason,
    reviewPaneState,
    reviewedCardQueueDueState,
  };
}

function isValidPostReviewObservation(
  observation: PostReviewObservation,
  reviewedFrontText: string,
): boolean {
  if (observation.reviewedCardQueueDueState !== "upcoming") {
    return false;
  }

  if (observation.reviewPaneState === "empty") {
    return observation.reviewPaneEmptyReason === "nothing-due";
  }

  if (observation.reviewPaneState === "card") {
    return observation.reviewPaneEmptyReason === "none" && observation.currentFrontText !== null && observation.currentFrontText !== reviewedFrontText;
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
