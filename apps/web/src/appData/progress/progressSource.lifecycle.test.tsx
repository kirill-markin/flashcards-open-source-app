// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  ProgressSeries,
  ProgressSummaryPayload,
} from "../../types";
import {
  buildCurrentSeriesInput,
  buildCurrentSeriesScopeKey,
  buildCurrentSummaryScopeKey,
  buildServerSeries,
  buildServerSummary,
  createDeferredPromise,
  flushEffects,
  linkedCloudSettings,
  linkingReadyCloudSettings,
  loadLocalProgressDailyReviewsMock,
  loadLocalProgressSummaryMock,
  loadProgressSeriesMock,
  loadProgressSummaryMock,
  noProgressSections,
  renderHarness,
  renderInvalidationHarness,
  summaryAndSeriesSections,
  summaryAndSeriesWithInvalidationSections,
} from "./progressSourceTestSupport";

describe("useProgressSource lifecycle", () => {
  it("keeps linking-ready sessions local-only and skips both remote progress endpoints", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkingReadyCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).not.toHaveBeenCalled();
    expect(loadProgressSeriesMock).not.toHaveBeenCalled();
    expect(harness.getApi().progressSourceState.summary.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.series.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.source).toBe("local_only");
  });

  it("keeps local progress visible when server eligibility turns off during an in-flight refresh", async () => {
    const deferredSummary = createDeferredPromise<ProgressSummaryPayload>();
    const deferredSeries = createDeferredPromise<ProgressSeries>();
    const currentSeriesInput = buildCurrentSeriesInput();
    loadProgressSummaryMock.mockImplementation(() => deferredSummary.promise);
    loadProgressSeriesMock.mockImplementation(() => deferredSeries.promise);
    loadLocalProgressSummaryMock.mockResolvedValue({
      currentStreakDays: 3,
      hasReviewedToday: true,
      lastReviewedOn: currentSeriesInput.to,
      activeReviewDays: 4,
    });
    loadLocalProgressDailyReviewsMock.mockResolvedValue([
      {
        date: currentSeriesInput.to,
        reviewCount: 2,
      },
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(1);
    expect(harness.getApi().progressSourceState.summary.isLoading).toBe(false);
    expect(harness.getApi().progressSourceState.series.isLoading).toBe(false);

    harness.rerender({
      sessionVerificationState: "verified",
      cloudSettings: linkingReadyCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });
    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(1);
    expect(loadLocalProgressSummaryMock).toHaveBeenCalledTimes(2);
    expect(loadLocalProgressDailyReviewsMock).toHaveBeenCalledTimes(2);
    expect(harness.getApi().progressSourceState.summary.isLoading).toBe(false);
    expect(harness.getApi().progressSourceState.series.isLoading).toBe(false);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(4);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 2,
    });

    deferredSummary.resolve(buildServerSummary(9, "2026-04-18T09:19:00.000Z"));
    deferredSeries.resolve(buildServerSeries(9, "2026-04-18T09:19:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.series.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.summary.isLoading).toBe(false);
    expect(harness.getApi().progressSourceState.series.isLoading).toBe(false);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(4);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 2,
    });
  });

  it("ignores server responses after sections disable their scopes", async () => {
    const deferredSummary = createDeferredPromise<ProgressSummaryPayload>();
    const deferredSeries = createDeferredPromise<ProgressSeries>();
    loadProgressSummaryMock.mockImplementation(() => deferredSummary.promise);
    loadProgressSeriesMock.mockImplementation(() => deferredSeries.promise);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    harness.rerender({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: noProgressSections,
    });

    deferredSummary.resolve(buildServerSummary(9, "2026-04-18T09:19:00.000Z"));
    deferredSeries.resolve(buildServerSeries(9, "2026-04-18T09:19:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary).toEqual({
      scopeKey: null,
      localFallback: null,
      serverBase: null,
      hasPendingLocalReviews: false,
      renderedSnapshot: null,
      isLoading: false,
      errorMessage: "",
    });
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

  it("coalesces rapid manual refreshes without rendering or caching stale responses", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    const firstSummaryRefresh = createDeferredPromise<ProgressSummaryPayload>();
    const secondSummaryRefresh = createDeferredPromise<ProgressSummaryPayload>();
    const firstSeriesRefresh = createDeferredPromise<ProgressSeries>();
    const secondSeriesRefresh = createDeferredPromise<ProgressSeries>();
    const refreshPromises: Array<Promise<void>> = [];
    const currentSeriesInput = buildCurrentSeriesInput();
    const summaryCacheKey = `flashcards-progress-server-summary:${buildCurrentSummaryScopeKey()}`;
    const seriesCacheKey = `flashcards-progress-server-series:${buildCurrentSeriesScopeKey()}`;
    loadProgressSummaryMock.mockClear();
    loadProgressSeriesMock.mockClear();
    loadProgressSummaryMock
      .mockImplementationOnce(() => firstSummaryRefresh.promise)
      .mockImplementationOnce(() => secondSummaryRefresh.promise);
    loadProgressSeriesMock
      .mockImplementationOnce(() => firstSeriesRefresh.promise)
      .mockImplementationOnce(() => secondSeriesRefresh.promise);

    act(() => {
      refreshPromises.push(harness.getApi().refreshProgress());
      refreshPromises.push(harness.getApi().refreshProgress());
    });
    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(1);

    firstSummaryRefresh.resolve(buildServerSummary(2, "2026-04-18T09:20:00.000Z"));
    firstSeriesRefresh.resolve(buildServerSeries(2, "2026-04-18T09:20:00.000Z"));
    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(2);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(2);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(1);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 1,
    });
    expect(window.localStorage.getItem(summaryCacheKey)).not.toContain("2026-04-18T09:20:00.000Z");
    expect(window.localStorage.getItem(seriesCacheKey)).not.toContain("2026-04-18T09:20:00.000Z");

    secondSummaryRefresh.resolve(buildServerSummary(9, "2026-04-18T09:21:00.000Z"));
    secondSeriesRefresh.resolve(buildServerSeries(9, "2026-04-18T09:21:00.000Z"));
    await act(async () => {
      await Promise.all(refreshPromises);
    });
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(9);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 9,
    });
    expect(window.localStorage.getItem(summaryCacheKey)).toContain("2026-04-18T09:21:00.000Z");
    expect(window.localStorage.getItem(summaryCacheKey)).not.toContain("2026-04-18T09:20:00.000Z");
    expect(window.localStorage.getItem(seriesCacheKey)).toContain("2026-04-18T09:21:00.000Z");
    expect(window.localStorage.getItem(seriesCacheKey)).not.toContain("2026-04-18T09:20:00.000Z");
  });

  it("ignores stale manual refresh errors while continuing to latest progress responses", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    const firstSummaryRefresh = createDeferredPromise<ProgressSummaryPayload>();
    const secondSummaryRefresh = createDeferredPromise<ProgressSummaryPayload>();
    const firstSeriesRefresh = createDeferredPromise<ProgressSeries>();
    const secondSeriesRefresh = createDeferredPromise<ProgressSeries>();
    const refreshPromises: Array<Promise<void>> = [];
    loadProgressSummaryMock.mockClear();
    loadProgressSeriesMock.mockClear();
    loadProgressSummaryMock
      .mockImplementationOnce(() => firstSummaryRefresh.promise)
      .mockImplementationOnce(() => secondSummaryRefresh.promise);
    loadProgressSeriesMock
      .mockImplementationOnce(() => firstSeriesRefresh.promise)
      .mockImplementationOnce(() => secondSeriesRefresh.promise);

    act(() => {
      refreshPromises.push(harness.getApi().refreshProgress());
      refreshPromises.push(harness.getApi().refreshProgress());
    });
    await flushEffects();

    firstSummaryRefresh.reject(new Error("Stale summary failure"));
    firstSeriesRefresh.reject(new Error("Stale series failure"));
    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(2);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(2);
    expect(harness.getApi().progressSourceState.summary.errorMessage).toBe("");
    expect(harness.getApi().progressSourceState.series.errorMessage).toBe("");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(1);

    secondSummaryRefresh.resolve(buildServerSummary(5, "2026-04-18T09:22:00.000Z"));
    secondSeriesRefresh.resolve(buildServerSeries(5, "2026-04-18T09:22:00.000Z"));
    await act(async () => {
      await Promise.all(refreshPromises);
    });
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.errorMessage).toBe("");
    expect(harness.getApi().progressSourceState.series.errorMessage).toBe("");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(5);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: buildCurrentSeriesInput().to,
      reviewCount: 5,
    });
  });

  it("refreshes only once per endpoint when the local day rolls over", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));

    renderInvalidationHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesWithInvalidationSections,
    });

    await flushEffects();

    loadProgressSummaryMock.mockClear();
    loadProgressSeriesMock.mockClear();

    act(() => {
      vi.setSystemTime(new Date("2026-04-21T12:00:00.000Z"));
      vi.advanceTimersByTime(60_000);
    });
    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(1);
  });
});
