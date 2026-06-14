// @vitest-environment jsdom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../../../types";
import {
  clickElementAsync,
  createCard,
  setupReviewScreenTest,
} from "../testSupport/ReviewScreenTestSupport";

const observabilityMocks = vi.hoisted(() => ({
  captureAppOperationErrorMock: vi.fn(),
}));

const progressMocks = vi.hoisted(() => ({
  loadLocalProgressDailyReviewsMock: vi.fn(),
  loadLocalProgressSummaryMock: vi.fn(),
}));

vi.mock("../../../observability/appOperationObservation", () => ({
  captureAppOperationError: observabilityMocks.captureAppOperationErrorMock,
}));

vi.mock("../../../localDb/progress/progress", () => ({
  loadLocalProgressDailyReviews: progressMocks.loadLocalProgressDailyReviewsMock,
  loadLocalProgressSummary: progressMocks.loadLocalProgressSummaryMock,
}));

const {
  getContainer,
  getState,
  renderReviewScreen,
  revealAnswer,
} = setupReviewScreenTest();

beforeEach(() => {
  observabilityMocks.captureAppOperationErrorMock.mockReset();
  progressMocks.loadLocalProgressDailyReviewsMock.mockReset();
  progressMocks.loadLocalProgressSummaryMock.mockReset();
});

async function flushReviewScreenPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ReviewScreen feedback observability", () => {
  it("reports automatic feedback activity load failures through app operation observation", async () => {
    const activityLoadError = new Error("Progress activity failed");
    const state = getState();
    const card = createCard({
      cardId: "card-feedback-observability",
      frontText: "Feedback observability question",
      backText: "Feedback observability answer",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => card);
    progressMocks.loadLocalProgressSummaryMock.mockRejectedValue(activityLoadError);
    progressMocks.loadLocalProgressDailyReviewsMock.mockResolvedValue([
      { date: "2026-03-10", reviewCount: 15 },
    ]);

    await renderReviewScreen();
    await revealAnswer();

    const goodButton = getContainer().querySelector("[data-testid='review-rate-good']");
    if (!(goodButton instanceof HTMLButtonElement)) {
      throw new Error("Good rating button was not found");
    }

    await clickElementAsync(goodButton);
    await flushReviewScreenPromises();

    expect(observabilityMocks.captureAppOperationErrorMock).toHaveBeenCalledTimes(1);
    expect(observabilityMocks.captureAppOperationErrorMock).toHaveBeenCalledWith(activityLoadError, {
      feature: "feedback",
      operation: "feedback_activity_load",
      userId: null,
      workspaceId: "workspace-1",
      installationId: null,
      entityId: null,
    });
  });
});
