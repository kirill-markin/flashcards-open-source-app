// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { progressLeaderboardHash, progressStreakHash } from "../../routes";
import {
  createAppData,
  createLeaderboardSourceState,
  createProgressSeriesSnapshot,
  createProgressSummarySnapshot,
  createProgressScreenRenderTestContext,
  createReviewScheduleSnapshot,
  refreshProgressMock,
  useAppDataMock,
  useProgressInvalidationStateMock,
  useProgressSourceMock,
} from "./ProgressScreenTestSupport";

describe("ProgressScreen shell", () => {
  const progressScreen = createProgressScreenRenderTestContext();

  it("renders shared flame SVGs on progress without emoji text", async () => {
    await progressScreen.renderProgressScreen();
    const container = progressScreen.getContainer();

    expect(container.textContent).not.toContain("🔥");
    expect(container.textContent).toContain("1/3");

    const summaryBadgeIcon = container.querySelector(".progress-streak-summary .review-progress-badge-icon");
    if (!(summaryBadgeIcon instanceof SVGSVGElement)) {
      throw new Error("Progress summary badge SVG icon was not found");
    }

    const streakMarkerIcons = [...container.querySelectorAll(".progress-streak-marker-flame .review-progress-badge-icon")];
    expect(streakMarkerIcons.length).toBeGreaterThan(0);
    expect(streakMarkerIcons.every((icon) => icon instanceof SVGSVGElement)).toBe(true);

    const frozenMarkerIcons = [...container.querySelectorAll(".progress-streak-marker-freeze .review-progress-badge-icon")];
    expect(frozenMarkerIcons.length).toBeGreaterThan(0);
    expect(frozenMarkerIcons.every((icon) => icon instanceof SVGSVGElement)).toBe(true);
  });

  it("uses the schedule-specific progress version for review schedule refreshes", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      localReadVersion: 7,
    });
    useProgressInvalidationStateMock.mockReturnValue({
      progressLocalVersion: 2,
      progressScheduleLocalVersion: 3,
      progressServerInvalidationVersion: 5,
    });

    await progressScreen.renderProgressScreen();

    expect(useProgressSourceMock).toHaveBeenCalledWith(expect.objectContaining({
      progressLocalVersion: 2,
      progressScheduleLocalVersion: 3,
      progressServerInvalidationVersion: 5,
    }));
  });

  it("opens technical details when a later progress source fails after an expected inline error", async () => {
    const technicalError = new Error("Series server exploded");
    useProgressSourceMock.mockReturnValue({
      progressSourceState: {
        summary: {
          scopeKey: "progress::summary::UTC::2026-04-21",
          referenceLocalDate: "2026-04-21",
          localFallback: null,
          localFallbackActiveDates: [],
          serverBase: createProgressSummarySnapshot(),
          hasPendingLocalReviews: false,
          renderedSeriesContext: null,
          renderedSnapshot: createProgressSummarySnapshot(),
          isLoading: false,
          errorMessage: "Authentication required.",
          technicalError: null,
        },
        series: {
          scopeKey: "progress::series::UTC::2026-04-13::2026-04-21",
          localFallback: null,
          localFallbackActiveDates: [],
          serverBase: createProgressSeriesSnapshot(),
          pendingLocalOverlay: null,
          renderedSnapshot: createProgressSeriesSnapshot(),
          isLoading: false,
          errorMessage: "Series server exploded",
          technicalError,
        },
        reviewSchedule: {
          scopeKey: "progress::review-schedule::UTC::2026-04-21",
          localFallback: null,
          serverBase: createReviewScheduleSnapshot(),
          progressScheduleLocalVersion: 0,
          serverBaseProgressScheduleLocalVersion: 0,
          serverBaseLocalCardTotalDelta: 0,
          hasPendingLocalCardChanges: false,
          hasCompleteLocalCardState: false,
          pendingLocalCardTotalDelta: 0,
          renderedSnapshot: createReviewScheduleSnapshot(),
          isLoading: false,
          errorMessage: "",
          technicalError: null,
        },
        leaderboard: createLeaderboardSourceState("ready", null),
      },
      refreshProgress: refreshProgressMock,
    });

    await progressScreen.renderProgressScreen();
    await act(async () => {
      await Promise.resolve();
    });
    const container = progressScreen.getContainer();

    expect(container.querySelector(".error-banner")?.textContent).toContain("Authentication required.");
    const dialog = document.body.querySelector("[data-testid='app-error-dialog']");
    if (!(dialog instanceof HTMLElement)) {
      throw new Error("Expected technical error dialog to open");
    }
    const details = dialog.querySelector("[data-testid='app-error-dialog-details']");
    if (!(details instanceof HTMLElement)) {
      throw new Error("Expected technical error dialog details to render");
    }
    expect(details.textContent).toContain("Series server exploded");
  });

  it("scrolls to the leaderboard card when the route hash targets it", async () => {
    await progressScreen.renderProgressScreenAtEntries([`/progress#${progressLeaderboardHash}`]);
    const container = progressScreen.getContainer();

    const leaderboardCard = container.querySelector("[data-testid='progress-leaderboard-card']");
    if (!(leaderboardCard instanceof HTMLElement)) {
      throw new Error("Leaderboard card was not found");
    }

    expect(leaderboardCard.id).toBe(progressLeaderboardHash);
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView)).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("scrolls to the streak card when the route hash targets it", async () => {
    await progressScreen.renderProgressScreenAtEntries([`/progress#${progressStreakHash}`]);
    const container = progressScreen.getContainer();

    const streakCard = container.querySelector("[data-testid='progress-streak-card']");
    if (!(streakCard instanceof HTMLElement)) {
      throw new Error("Streak card was not found");
    }

    expect(streakCard.id).toBe(progressStreakHash);
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView)).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });
});
