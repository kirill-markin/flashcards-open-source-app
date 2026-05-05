// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildCurrentSeriesInput,
  buildServerSeries,
  buildServerSummary,
  createDeferredPromise,
  flushEffects,
  hasPendingProgressReviewEventsMock,
  linkedCloudSettings,
  loadLocalProgressDailyReviewsMock,
  loadLocalProgressSummaryMock,
  loadPendingProgressDailyReviewsMock,
  loadProgressSeriesMock,
  loadProgressSummaryMock,
  renderHarness,
  seriesOnlySections,
  summaryAndSeriesSections,
  summaryOnlySections,
} from "./progressSourceTestSupport";

describe("useProgressSource summary and series", () => {
  it("loads split server summary and series for linked verified sessions", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(1);
    expect(harness.getApi().progressSourceState.summary.serverBase?.source).toBe("server");
    expect(harness.getApi().progressSourceState.series.serverBase?.source).toBe("server");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(1);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: buildCurrentSeriesInput().to,
      reviewCount: 1,
    });
  });

  it("updates summary and series independently when remote responses arrive in different orders", async () => {
    const deferredSummary = createDeferredPromise<ReturnType<typeof buildServerSummary>>();
    loadProgressSummaryMock.mockImplementation(() => deferredSummary.promise);
    loadProgressSeriesMock.mockResolvedValueOnce(buildServerSeries(3, "2026-04-18T09:16:00.000Z"));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.series.serverBase?.generatedAt).toBe("2026-04-18T09:16:00.000Z");
    expect(harness.getApi().progressSourceState.summary.serverBase?.generatedAt).not.toBe("2026-04-18T09:17:00.000Z");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: buildCurrentSeriesInput().to,
      reviewCount: 3,
    });

    deferredSummary.resolve(buildServerSummary(4, "2026-04-18T09:17:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase?.generatedAt).toBe("2026-04-18T09:17:00.000Z");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(4);
  });

  it("keeps rendered summary local when pending review uploads make the server summary stale", async () => {
    hasPendingProgressReviewEventsMock.mockResolvedValue(true);
    loadLocalProgressSummaryMock.mockResolvedValue({
      currentStreakDays: 2,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-18",
      activeReviewDays: 8,
    });

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase?.source).toBe("server");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(8);
  });

  it("renders server series with pending local review overlay as approximate", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    loadProgressSeriesMock.mockResolvedValue(buildServerSeries(4, "2026-04-18T09:18:00.000Z"));
    loadPendingProgressDailyReviewsMock.mockResolvedValue([
      {
        date: currentSeriesInput.to,
        reviewCount: 3,
      },
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: seriesOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.series.serverBase?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 4,
    });
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 7,
    });
  });

  it("supports summary-only ownership without loading the progress series pipeline", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryOnlySections,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadLocalProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(hasPendingProgressReviewEventsMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).not.toHaveBeenCalled();
    expect(loadLocalProgressDailyReviewsMock).not.toHaveBeenCalled();
    expect(loadPendingProgressDailyReviewsMock).not.toHaveBeenCalled();
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(1);
    expect(harness.getApi().progressSourceState.series).toEqual({
      scopeKey: null,
      localFallback: null,
      serverBase: null,
      pendingLocalOverlay: null,
      renderedSnapshot: null,
      isLoading: false,
      errorMessage: "",
    });
    expect(harness.getApi().progressSourceState.reviewSchedule).toEqual({
      scopeKey: null,
      localFallback: null,
      serverBase: null,
      progressScheduleLocalVersion: 0,
      serverBaseProgressScheduleLocalVersion: null,
      serverBaseLocalCardTotalDelta: 0,
      hasPendingLocalCardChanges: false,
      hasCompleteLocalCardState: false,
      pendingLocalCardTotalDelta: 0,
      renderedSnapshot: null,
      isLoading: false,
      errorMessage: "",
    });
  });
});
