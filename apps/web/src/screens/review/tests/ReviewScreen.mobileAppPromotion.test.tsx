// @vitest-environment jsdom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileAppPromotionState } from "../../../localDb/mobileAppPromotion/mobileAppPromotion";
import type { Card, DailyReviewPoint, FeedbackState } from "../../../types";
import {
  clickElementAsync,
  createCard,
  createDeferredPromise,
  setupReviewScreenTest,
} from "../testSupport/ReviewScreenTestSupport";
import {
  flushReviewScreenPromises,
} from "./controls/ReviewScreenControlTestSupport";

const apiMocks = vi.hoisted(() => ({
  loadFeedbackStateMock: vi.fn(),
  loadReviewPlatformSummaryMock: vi.fn(),
  recordFeedbackPromptEventMock: vi.fn(),
  submitFeedbackMock: vi.fn(),
}));

const mobileAppPromotionMocks = vi.hoisted(() => ({
  clearMobileAppPromotionPromptShownIfCurrentMock: vi.fn(),
  loadMobileAppPromotionStateMock: vi.fn(),
  storeKnownMobileReviewEventMock: vi.fn(),
  storeMobileAppPromotionPromptShownMock: vi.fn(),
}));

const observabilityMocks = vi.hoisted(() => ({
  captureAppOperationErrorMock: vi.fn(),
}));

const progressMocks = vi.hoisted(() => ({
  loadLocalProgressDailyReviewsMock: vi.fn(),
  loadLocalProgressSummaryMock: vi.fn(),
}));

vi.mock("../../../api/endpoints/reviewPlatformSummary", () => ({
  loadReviewPlatformSummary: apiMocks.loadReviewPlatformSummaryMock,
}));

vi.mock("../../../api/endpoints/feedback", () => ({
  loadFeedbackState: apiMocks.loadFeedbackStateMock,
  recordFeedbackPromptEvent: apiMocks.recordFeedbackPromptEventMock,
  submitFeedback: apiMocks.submitFeedbackMock,
}));

vi.mock("../../../localDb/mobileAppPromotion/mobileAppPromotion", () => ({
  clearMobileAppPromotionPromptShownIfCurrent: mobileAppPromotionMocks.clearMobileAppPromotionPromptShownIfCurrentMock,
  loadMobileAppPromotionState: mobileAppPromotionMocks.loadMobileAppPromotionStateMock,
  storeKnownMobileReviewEvent: mobileAppPromotionMocks.storeKnownMobileReviewEventMock,
  storeMobileAppPromotionPromptShown: mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock,
}));

vi.mock("../../../localDb/progress/progress", () => ({
  loadLocalProgressDailyReviews: progressMocks.loadLocalProgressDailyReviewsMock,
  loadLocalProgressSummary: progressMocks.loadLocalProgressSummaryMock,
}));

vi.mock("../../../observability/appOperationObservation", () => ({
  captureAppOperationError: observabilityMocks.captureAppOperationErrorMock,
}));

const {
  dispatchDocumentKeydown,
  getContainer,
  getState,
  openReviewFilterMenu,
  renderReviewScreen,
  rerenderReviewScreen,
  revealAnswer,
} = setupReviewScreenTest();

let mobileAppPromotionStateForTest: MobileAppPromotionState;

function createEmptyMobileAppPromotionState(): MobileAppPromotionState {
  return {
    lastPromptShownLocalDate: null,
    lastPromptShownAt: null,
    knownHasMobileReviewEvent: false,
  };
}

function createDailyReviewPoint(localDate: string, reviewCount: number): DailyReviewPoint {
  return {
    date: localDate,
    reviewCount,
    againCount: 0,
    hardCount: 0,
    goodCount: reviewCount,
    easyCount: 0,
  };
}

function configureTodayReviewCount(localDate: string, reviewCount: number): void {
  progressMocks.loadLocalProgressDailyReviewsMock.mockResolvedValue([createDailyReviewPoint(localDate, reviewCount)]);
  progressMocks.loadLocalProgressSummaryMock.mockResolvedValue({
    currentStreakDays: 1,
    longestStreakDays: 1,
    hasReviewedToday: true,
    lastReviewedOn: localDate,
    activeReviewDays: 1,
    streakFreeze: {
      availableCredits: 0,
      capacity: 2,
      balanceUnits: 0,
      unitsPerCredit: 7,
      earnedUnitsPerStreakDay: 1,
      nextCreditProgressUnits: 0,
      nextCreditRequiredUnits: 7,
    },
  });
}

function configureFeedbackEligibleReviewActivity(localDate: string, reviewCount: number): void {
  configureTodayReviewCount(localDate, reviewCount);
  progressMocks.loadLocalProgressSummaryMock.mockResolvedValue({
    currentStreakDays: 2,
    longestStreakDays: 2,
    hasReviewedToday: true,
    lastReviewedOn: localDate,
    activeReviewDays: 2,
    streakFreeze: {
      availableCredits: 0,
      capacity: 2,
      balanceUnits: 0,
      unitsPerCredit: 7,
      earnedUnitsPerStreakDay: 1,
      nextCreditProgressUnits: 0,
      nextCreditRequiredUnits: 7,
    },
  });
}

function configureMobileAppPromotionState(state: MobileAppPromotionState): void {
  mobileAppPromotionStateForTest = state;
  mobileAppPromotionMocks.loadMobileAppPromotionStateMock.mockImplementation(
    async (): Promise<MobileAppPromotionState> => mobileAppPromotionStateForTest,
  );
  mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock.mockImplementation(
    async (input: Readonly<{
      identityKey: string;
      localDate: string;
      shownAt: string;
    }>): Promise<MobileAppPromotionState> => {
      mobileAppPromotionStateForTest = {
        ...mobileAppPromotionStateForTest,
        lastPromptShownLocalDate: input.localDate,
        lastPromptShownAt: input.shownAt,
      };
      return mobileAppPromotionStateForTest;
    },
  );
  mobileAppPromotionMocks.clearMobileAppPromotionPromptShownIfCurrentMock.mockImplementation(
    async (input: Readonly<{
      identityKey: string;
      localDate: string;
      shownAt: string;
    }>): Promise<MobileAppPromotionState> => {
      if (
        mobileAppPromotionStateForTest.lastPromptShownLocalDate !== input.localDate
        || mobileAppPromotionStateForTest.lastPromptShownAt !== input.shownAt
      ) {
        return mobileAppPromotionStateForTest;
      }

      mobileAppPromotionStateForTest = {
        ...mobileAppPromotionStateForTest,
        lastPromptShownLocalDate: null,
        lastPromptShownAt: null,
      };
      return mobileAppPromotionStateForTest;
    },
  );
  mobileAppPromotionMocks.storeKnownMobileReviewEventMock.mockImplementation(
    async (): Promise<MobileAppPromotionState> => {
      mobileAppPromotionStateForTest = {
        ...mobileAppPromotionStateForTest,
        knownHasMobileReviewEvent: true,
      };
      return mobileAppPromotionStateForTest;
    },
  );
}

function createReviewCards(count: number): Array<Card> {
  return Array.from({ length: count }, (_value, index) => createCard({
    cardId: `mobile-promo-card-${index + 1}`,
    frontText: `Mobile promo question ${index + 1}`,
    backText: `Mobile promo answer ${index + 1}`,
  }));
}

function prepareReviewQueue(cardCount: number): void {
  const state = getState();
  const cards = createReviewCards(cardCount);
  state.cards = cards;
  state.reviewQueue = cards;
  state.reviewTimeline = cards;
  state.appData.submitReviewItem.mockImplementation(async (cardId: string): Promise<Card> => {
    const submittedCard = cards.find((card) => card.cardId === cardId);
    if (submittedCard === undefined) {
      throw new Error(`Unexpected submitted review card id: ${cardId}`);
    }

    return submittedCard;
  });
}

async function flushReviewPromptPromises(): Promise<void> {
  await flushReviewScreenPromises();
  await flushReviewScreenPromises();
  await flushReviewScreenPromises();
}

async function submitGoodReview(): Promise<void> {
  await revealAnswer();
  const goodButton = getContainer().querySelector("[data-testid='review-rate-good']");
  if (!(goodButton instanceof HTMLButtonElement)) {
    throw new Error("Good rating button was not found");
  }

  await clickElementAsync(goodButton);
}

function queryMobileAppPromotionDialog(): HTMLElement | null {
  const dialog = getContainer().querySelector("[data-testid='mobile-app-promo-dialog']");
  if (dialog === null) {
    return null;
  }

  if (!(dialog instanceof HTMLElement)) {
    throw new Error("Mobile app promotion dialog was not an HTMLElement");
  }

  return dialog;
}

function queryFeedbackDialog(): HTMLElement | null {
  const dialog = getContainer().querySelector("[data-testid='feedback-dialog']");
  if (dialog === null) {
    return null;
  }

  if (!(dialog instanceof HTMLElement)) {
    throw new Error("Feedback dialog was not an HTMLElement");
  }

  return dialog;
}

function createFeedbackState(): FeedbackState {
  return {
    automaticPromptCooldownDays: 30,
    lastAutomaticPromptShownAt: null,
    lastFeedbackSubmittedAt: null,
    nextAutomaticPromptAt: null,
  };
}

beforeEach(() => {
  apiMocks.loadFeedbackStateMock.mockReset();
  apiMocks.loadReviewPlatformSummaryMock.mockReset();
  apiMocks.recordFeedbackPromptEventMock.mockReset();
  apiMocks.submitFeedbackMock.mockReset();
  mobileAppPromotionMocks.clearMobileAppPromotionPromptShownIfCurrentMock.mockReset();
  mobileAppPromotionMocks.loadMobileAppPromotionStateMock.mockReset();
  mobileAppPromotionMocks.storeKnownMobileReviewEventMock.mockReset();
  mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock.mockReset();
  observabilityMocks.captureAppOperationErrorMock.mockReset();
  progressMocks.loadLocalProgressDailyReviewsMock.mockReset();
  progressMocks.loadLocalProgressSummaryMock.mockReset();

  configureTodayReviewCount("2026-03-10", 5);
  configureMobileAppPromotionState(createEmptyMobileAppPromotionState());
  apiMocks.loadFeedbackStateMock.mockResolvedValue(createFeedbackState());
  apiMocks.loadReviewPlatformSummaryMock.mockResolvedValue({
    hasMobileReviewEvent: false,
  });
  apiMocks.recordFeedbackPromptEventMock.mockResolvedValue(createFeedbackState());
  apiMocks.submitFeedbackMock.mockResolvedValue(createFeedbackState());
});

describe("ReviewScreen mobile app promotion", () => {
  it("does not show before five local reviews today", async () => {
    configureTodayReviewCount("2026-03-10", 4);
    prepareReviewQueue(1);

    await renderReviewScreen();
    await submitGoodReview();
    await flushReviewPromptPromises();

    expect(queryMobileAppPromotionDialog()).toBeNull();
    expect(apiMocks.loadReviewPlatformSummaryMock).not.toHaveBeenCalled();
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).not.toHaveBeenCalled();
  });

  it("shows after five local reviews when the backend has no mobile review event", async () => {
    const shownState = {
      ...createEmptyMobileAppPromotionState(),
      lastPromptShownLocalDate: "2026-03-10",
      lastPromptShownAt: "2026-03-10T12:00:00.000Z",
    };
    const shownDeferred = createDeferredPromise<MobileAppPromotionState>();
    mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock.mockImplementation(
      async (): Promise<MobileAppPromotionState> => shownDeferred.promise,
    );
    prepareReviewQueue(2);

    await renderReviewScreen();
    await submitGoodReview();

    await vi.waitFor(() => {
      expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).toHaveBeenCalledTimes(1);
    });
    expect(queryMobileAppPromotionDialog()).toBeNull();

    await act(async () => {
      shownDeferred.resolve(shownState);
      await Promise.resolve();
    });
    await flushReviewPromptPromises();

    expect(queryMobileAppPromotionDialog()).not.toBeNull();
    expect(apiMocks.loadReviewPlatformSummaryMock).toHaveBeenCalledTimes(1);

    await dispatchDocumentKeydown(" ");

    expect(getContainer().textContent).not.toContain("Mobile promo answer 2");
  });

  it("serializes overlapping mobile promotion checks for the same local date", async () => {
    const summaryDeferred = createDeferredPromise<Readonly<{ hasMobileReviewEvent: boolean }>>();
    apiMocks.loadReviewPlatformSummaryMock.mockImplementation(
      async (): Promise<Readonly<{ hasMobileReviewEvent: boolean }>> => summaryDeferred.promise,
    );
    prepareReviewQueue(3);

    await renderReviewScreen();
    await submitGoodReview();

    await vi.waitFor(() => {
      expect(apiMocks.loadReviewPlatformSummaryMock).toHaveBeenCalledTimes(1);
    });

    await submitGoodReview();
    await flushReviewPromptPromises();

    expect(apiMocks.loadReviewPlatformSummaryMock).toHaveBeenCalledTimes(1);
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).not.toHaveBeenCalled();

    await act(async () => {
      summaryDeferred.resolve({
        hasMobileReviewEvent: false,
      });
      await Promise.resolve();
    });
    await flushReviewPromptPromises();

    expect(apiMocks.loadReviewPlatformSummaryMock).toHaveBeenCalledTimes(1);
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).toHaveBeenCalledTimes(1);
    expect(queryMobileAppPromotionDialog()).not.toBeNull();
  });

  it("does not open automatic feedback while an overlapping mobile promotion check later succeeds", async () => {
    const summaryDeferred = createDeferredPromise<Readonly<{ hasMobileReviewEvent: boolean }>>();
    apiMocks.loadReviewPlatformSummaryMock.mockImplementation(
      async (): Promise<Readonly<{ hasMobileReviewEvent: boolean }>> => summaryDeferred.promise,
    );
    configureFeedbackEligibleReviewActivity("2026-03-10", 15);
    prepareReviewQueue(3);

    await renderReviewScreen();
    await submitGoodReview();

    await vi.waitFor(() => {
      expect(apiMocks.loadReviewPlatformSummaryMock).toHaveBeenCalledTimes(1);
    });

    await submitGoodReview();
    await flushReviewPromptPromises();

    expect(queryFeedbackDialog()).toBeNull();
    expect(queryMobileAppPromotionDialog()).toBeNull();
    expect(apiMocks.loadFeedbackStateMock).not.toHaveBeenCalled();

    await act(async () => {
      summaryDeferred.resolve({
        hasMobileReviewEvent: false,
      });
      await Promise.resolve();
    });
    await flushReviewPromptPromises();

    expect(queryMobileAppPromotionDialog()).not.toBeNull();
    expect(queryFeedbackDialog()).toBeNull();
    expect(apiMocks.loadReviewPlatformSummaryMock).toHaveBeenCalledTimes(1);
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).toHaveBeenCalledTimes(1);
    expect(apiMocks.loadFeedbackStateMock).not.toHaveBeenCalled();
  });

  it("starts a new mobile promotion check when the workspace changes while another check is pending", async () => {
    const firstSummaryDeferred = createDeferredPromise<Readonly<{ hasMobileReviewEvent: boolean }>>();
    const secondSummaryDeferred = createDeferredPromise<Readonly<{ hasMobileReviewEvent: boolean }>>();
    apiMocks.loadReviewPlatformSummaryMock
      .mockImplementationOnce(async (): Promise<Readonly<{ hasMobileReviewEvent: boolean }>> => firstSummaryDeferred.promise)
      .mockImplementationOnce(async (): Promise<Readonly<{ hasMobileReviewEvent: boolean }>> => secondSummaryDeferred.promise);
    configureFeedbackEligibleReviewActivity("2026-03-10", 15);
    prepareReviewQueue(3);

    await renderReviewScreen();
    await submitGoodReview();

    await vi.waitFor(() => {
      expect(apiMocks.loadReviewPlatformSummaryMock).toHaveBeenCalledTimes(1);
    });

    getState().appData.activeWorkspace = {
      workspaceId: "workspace-2",
      name: "Secondary",
      createdAt: "2026-03-10T00:00:00.000Z",
      isSelected: true,
    };
    await rerenderReviewScreen();
    await submitGoodReview();

    await vi.waitFor(() => {
      expect(apiMocks.loadReviewPlatformSummaryMock).toHaveBeenCalledTimes(2);
    });
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).not.toHaveBeenCalled();

    await act(async () => {
      firstSummaryDeferred.resolve({
        hasMobileReviewEvent: false,
      });
      await Promise.resolve();
    });
    await flushReviewPromptPromises();

    expect(queryFeedbackDialog()).toBeNull();
    expect(queryMobileAppPromotionDialog()).toBeNull();
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).not.toHaveBeenCalled();

    await act(async () => {
      secondSummaryDeferred.resolve({
        hasMobileReviewEvent: false,
      });
      await Promise.resolve();
    });
    await flushReviewPromptPromises();

    expect(queryMobileAppPromotionDialog()).not.toBeNull();
    expect(queryFeedbackDialog()).toBeNull();
    expect(apiMocks.loadReviewPlatformSummaryMock).toHaveBeenCalledTimes(2);
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).toHaveBeenCalledTimes(1);
    expect(apiMocks.loadFeedbackStateMock).not.toHaveBeenCalled();
  });

  it("does not open automatic feedback when a stale mobile promotion check skips before the threshold", async () => {
    const mobileActivityDeferred = createDeferredPromise<ReadonlyArray<DailyReviewPoint>>();
    configureFeedbackEligibleReviewActivity("2026-03-10", 15);
    progressMocks.loadLocalProgressDailyReviewsMock
      .mockImplementationOnce(async (): Promise<ReadonlyArray<DailyReviewPoint>> => mobileActivityDeferred.promise)
      .mockResolvedValue([createDailyReviewPoint("2026-03-10", 15)]);
    prepareReviewQueue(1);

    await renderReviewScreen();
    await submitGoodReview();

    await vi.waitFor(() => {
      expect(progressMocks.loadLocalProgressDailyReviewsMock).toHaveBeenCalledTimes(1);
    });

    getState().appData.activeWorkspace = {
      workspaceId: "workspace-2",
      name: "Secondary",
      createdAt: "2026-03-10T00:00:00.000Z",
      isSelected: true,
    };
    await rerenderReviewScreen();

    await act(async () => {
      mobileActivityDeferred.resolve([createDailyReviewPoint("2026-03-10", 4)]);
      await Promise.resolve();
    });
    await flushReviewPromptPromises();

    expect(queryFeedbackDialog()).toBeNull();
    expect(queryMobileAppPromotionDialog()).toBeNull();
    expect(apiMocks.loadReviewPlatformSummaryMock).not.toHaveBeenCalled();
    expect(apiMocks.loadFeedbackStateMock).not.toHaveBeenCalled();
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).not.toHaveBeenCalled();
  });

  it("does not open over a blocker that appears while the prompt shown state is saving", async () => {
    const shownDeferred = createDeferredPromise<MobileAppPromotionState>();
    mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock.mockImplementation(
      async (input: Readonly<{
        identityKey: string;
        localDate: string;
        shownAt: string;
      }>): Promise<MobileAppPromotionState> => {
        await shownDeferred.promise;
        mobileAppPromotionStateForTest = {
          ...mobileAppPromotionStateForTest,
          lastPromptShownLocalDate: input.localDate,
          lastPromptShownAt: input.shownAt,
        };
        return mobileAppPromotionStateForTest;
      },
    );
    prepareReviewQueue(2);

    await renderReviewScreen();
    await submitGoodReview();

    await vi.waitFor(() => {
      expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).toHaveBeenCalledTimes(1);
    });

    await openReviewFilterMenu();

    await act(async () => {
      shownDeferred.resolve({
        ...createEmptyMobileAppPromotionState(),
        lastPromptShownLocalDate: "2026-03-10",
        lastPromptShownAt: "2026-03-10T12:00:00.000Z",
      });
      await Promise.resolve();
    });
    await flushReviewPromptPromises();

    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).toHaveBeenCalledTimes(1);
    expect(mobileAppPromotionMocks.clearMobileAppPromotionPromptShownIfCurrentMock).toHaveBeenCalledTimes(1);
    expect(mobileAppPromotionStateForTest).toEqual(createEmptyMobileAppPromotionState());
    expect(queryMobileAppPromotionDialog()).toBeNull();
  });

  it("clears the prompt marker when the workspace changes while the prompt shown state is saving", async () => {
    const shownDeferred = createDeferredPromise<MobileAppPromotionState>();
    mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock.mockImplementation(
      async (input: Readonly<{
        identityKey: string;
        localDate: string;
        shownAt: string;
      }>): Promise<MobileAppPromotionState> => {
        await shownDeferred.promise;
        mobileAppPromotionStateForTest = {
          ...mobileAppPromotionStateForTest,
          lastPromptShownLocalDate: input.localDate,
          lastPromptShownAt: input.shownAt,
        };
        return mobileAppPromotionStateForTest;
      },
    );
    prepareReviewQueue(2);

    await renderReviewScreen();
    await submitGoodReview();

    await vi.waitFor(() => {
      expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).toHaveBeenCalledTimes(1);
    });

    getState().appData.activeWorkspace = {
      workspaceId: "workspace-2",
      name: "Secondary",
      createdAt: "2026-03-10T00:00:00.000Z",
      isSelected: true,
    };
    await rerenderReviewScreen();

    await act(async () => {
      shownDeferred.resolve({
        ...createEmptyMobileAppPromotionState(),
        lastPromptShownLocalDate: "2026-03-10",
        lastPromptShownAt: "2026-03-10T12:00:00.000Z",
      });
      await Promise.resolve();
    });
    await flushReviewPromptPromises();

    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).toHaveBeenCalledTimes(1);
    expect(mobileAppPromotionMocks.clearMobileAppPromotionPromptShownIfCurrentMock).toHaveBeenCalledTimes(1);
    expect(mobileAppPromotionStateForTest).toEqual(createEmptyMobileAppPromotionState());
    expect(queryMobileAppPromotionDialog()).toBeNull();
  });

  it("does not show twice on the same local date", async () => {
    configureMobileAppPromotionState({
      ...createEmptyMobileAppPromotionState(),
      lastPromptShownLocalDate: "2026-03-10",
      lastPromptShownAt: "2026-03-10T08:00:00.000Z",
    });
    configureTodayReviewCount("2026-03-10", 6);
    prepareReviewQueue(1);

    await renderReviewScreen();
    await submitGoodReview();
    await flushReviewPromptPromises();

    expect(queryMobileAppPromotionDialog()).toBeNull();
    expect(apiMocks.loadReviewPlatformSummaryMock).not.toHaveBeenCalled();
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).not.toHaveBeenCalled();
  });

  it("can show again on a new local date", async () => {
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));
    configureMobileAppPromotionState({
      ...createEmptyMobileAppPromotionState(),
      lastPromptShownLocalDate: "2026-03-10",
      lastPromptShownAt: "2026-03-10T08:00:00.000Z",
    });
    configureTodayReviewCount("2026-03-11", 5);
    prepareReviewQueue(1);

    await renderReviewScreen();
    await submitGoodReview();
    await flushReviewPromptPromises();

    expect(queryMobileAppPromotionDialog()).not.toBeNull();
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).toHaveBeenCalledTimes(1);
  });

  it("does not show when the backend already knows about a mobile review event", async () => {
    apiMocks.loadReviewPlatformSummaryMock.mockResolvedValue({
      hasMobileReviewEvent: true,
    });
    prepareReviewQueue(1);

    await renderReviewScreen();
    await submitGoodReview();
    await flushReviewPromptPromises();

    expect(queryMobileAppPromotionDialog()).toBeNull();
    expect(mobileAppPromotionMocks.storeKnownMobileReviewEventMock).toHaveBeenCalledTimes(1);
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).not.toHaveBeenCalled();
  });

  it("does not mark the prompt shown when backend status loading fails", async () => {
    const statusError = new Error("Review platform summary failed");
    apiMocks.loadReviewPlatformSummaryMock.mockRejectedValue(statusError);
    prepareReviewQueue(1);

    await renderReviewScreen();
    await submitGoodReview();
    await flushReviewPromptPromises();

    expect(queryMobileAppPromotionDialog()).toBeNull();
    expect(mobileAppPromotionMocks.storeMobileAppPromotionPromptShownMock).not.toHaveBeenCalled();
    expect(observabilityMocks.captureAppOperationErrorMock).toHaveBeenCalledWith(statusError, {
      feature: "mobile_app_promo",
      operation: "mobile_app_promo_status_load",
      userId: null,
      workspaceId: "workspace-1",
      installationId: null,
      entityId: null,
    });
  });
});
