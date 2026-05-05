// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type {
  ProgressReviewSchedule,
  ProgressSeries,
  ProgressSummaryPayload,
} from "../../types";
import {
  buildCurrentReviewScheduleInput,
  buildCurrentReviewScheduleScopeKey,
  buildCurrentSeriesInput,
  buildCurrentSeriesScopeKey,
  buildCurrentSummaryScopeKey,
  buildServerReviewSchedule,
  buildServerSeries,
  buildServerSummary,
  createDeferredPromise,
  flushEffects,
  linkedCloudSettings,
  loadProgressReviewScheduleMock,
  loadProgressSeriesMock,
  loadProgressSummaryMock,
  renderHarness,
  replaceProgressReviewScheduleBucketCount,
  reviewScheduleOnlySections,
  seriesOnlySections,
  storePersistedProgressReviewScheduleForTest,
  storePersistedProgressSeriesForTest,
  storePersistedProgressSummaryForTest,
  summaryAndSeriesSections,
  swapFirstProgressReviewScheduleBuckets,
} from "./progressSourceTestSupport";

describe("useProgressSource cache", () => {
  it("hydrates matching server cache before remote refresh completes", async () => {
    const cachedSummary = buildServerSummary(6, "2026-04-18T09:10:00.000Z");
    const cachedSeries = buildServerSeries(6, "2026-04-18T09:10:00.000Z");
    const deferredSummary = createDeferredPromise<ProgressSummaryPayload>();
    const deferredSeries = createDeferredPromise<ProgressSeries>();
    storePersistedProgressSummaryForTest(buildCurrentSummaryScopeKey(), cachedSummary);
    storePersistedProgressSeriesForTest(buildCurrentSeriesScopeKey(), cachedSeries);
    loadProgressSummaryMock.mockImplementation(() => deferredSummary.promise);
    loadProgressSeriesMock.mockImplementation(() => deferredSeries.promise);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase?.generatedAt).toBe("2026-04-18T09:10:00.000Z");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(6);
    expect(harness.getApi().progressSourceState.series.serverBase?.generatedAt).toBe("2026-04-18T09:10:00.000Z");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: buildCurrentSeriesInput().to,
      reviewCount: 6,
    });

    deferredSummary.resolve(buildServerSummary(7, "2026-04-18T09:11:00.000Z"));
    deferredSeries.resolve(buildServerSeries(7, "2026-04-18T09:11:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(7);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: buildCurrentSeriesInput().to,
      reviewCount: 7,
    });
  });

  it("treats corrupt and mismatched cache entries as misses", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deferredSummary = createDeferredPromise<ProgressSummaryPayload>();
    const deferredSeries = createDeferredPromise<ProgressSeries>();
    const summaryScopeKey = buildCurrentSummaryScopeKey();
    const seriesScopeKey = buildCurrentSeriesScopeKey();
    storePersistedProgressSummaryForTest("other-scope", buildServerSummary(6, "2026-04-18T09:10:00.000Z"));
    window.localStorage.setItem(`flashcards-progress-server-summary:${summaryScopeKey}`, window.localStorage.getItem("flashcards-progress-server-summary:other-scope") ?? "");
    window.localStorage.setItem(`flashcards-progress-server-series:${seriesScopeKey}`, "{not-json");
    loadProgressSummaryMock.mockImplementation(() => deferredSummary.promise);
    loadProgressSeriesMock.mockImplementation(() => deferredSeries.promise);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.series.serverBase).toBeNull();
    expect(warningSpy).toHaveBeenCalledWith("progress_cache_miss", expect.objectContaining({
      reason: "scope_mismatch",
      section: "summary",
    }));
    expect(warningSpy).toHaveBeenCalledWith("progress_cache_miss", expect.objectContaining({
      reason: "invalid_json",
      section: "series",
    }));

    warningSpy.mockRestore();
  });

  it("treats malformed cached series dates as invalid-shape misses before loading remote series", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const currentSeriesInput = buildCurrentSeriesInput();
    const seriesScopeKey = buildCurrentSeriesScopeKey();
    const malformedCachedSeries = {
      version: 1,
      scopeKey: seriesScopeKey,
      savedAt: "2026-04-18T09:00:00.000Z",
      serverBase: {
        timeZone: currentSeriesInput.timeZone,
        from: "not-a-local-date",
        to: currentSeriesInput.to,
        generatedAt: "2026-04-18T09:10:00.000Z",
        dailyReviews: [
          {
            date: currentSeriesInput.to,
            reviewCount: 12,
          },
        ],
      },
    } as const;
    loadProgressSeriesMock.mockResolvedValueOnce(buildServerSeries(8, "2026-04-18T09:23:00.000Z"));
    window.localStorage.setItem(
      `flashcards-progress-server-series:${seriesScopeKey}`,
      JSON.stringify(malformedCachedSeries),
    );

    try {
      const harness = renderHarness({
        sessionVerificationState: "verified",
        cloudSettings: linkedCloudSettings,
        progressServerInvalidationVersion: 0,
        sections: seriesOnlySections,
      });

      await flushEffects();

      expect(warningSpy).toHaveBeenCalledWith("progress_cache_miss", expect.objectContaining({
        reason: "invalid_shape",
        section: "series",
      }));
      expect(loadProgressSeriesMock).toHaveBeenCalledWith(currentSeriesInput);
      expect(harness.getApi().progressSourceState.series.serverBase?.generatedAt).toBe("2026-04-18T09:23:00.000Z");
      expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
        date: currentSeriesInput.to,
        reviewCount: 8,
      });
    } finally {
      warningSpy.mockRestore();
    }
  });

  const invalidProgressReviewScheduleCacheCases: ReadonlyArray<Readonly<{
    name: string;
    serverBase: ProgressReviewSchedule;
  }>> = [
    {
      name: "negative bucket count",
      serverBase: replaceProgressReviewScheduleBucketCount(buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"), 0, -1),
    },
    {
      name: "fractional bucket count",
      serverBase: replaceProgressReviewScheduleBucketCount(buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"), 0, 1.5),
    },
    {
      name: "negative totalCards",
      serverBase: {
        ...buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"),
        totalCards: -1,
      },
    },
    {
      name: "fractional totalCards",
      serverBase: {
        ...buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"),
        totalCards: 7.5,
      },
    },
    {
      name: "totalCards mismatch",
      serverBase: {
        ...buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"),
        totalCards: 99,
      },
    },
    {
      name: "unstable bucket order",
      serverBase: swapFirstProgressReviewScheduleBuckets(buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z")),
    },
  ];

  for (const invalidCase of invalidProgressReviewScheduleCacheCases) {
    it(`treats cached review schedule with ${invalidCase.name} as an invalid-shape miss before loading remote schedule`, async () => {
      const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const deferredReviewSchedule = createDeferredPromise<ProgressReviewSchedule>();
      const reviewScheduleScopeKey = buildCurrentReviewScheduleScopeKey();
      storePersistedProgressReviewScheduleForTest(reviewScheduleScopeKey, invalidCase.serverBase);
      loadProgressReviewScheduleMock.mockImplementation(() => deferredReviewSchedule.promise);

      try {
        const harness = renderHarness({
          sessionVerificationState: "verified",
          cloudSettings: linkedCloudSettings,
          progressServerInvalidationVersion: 0,
          sections: reviewScheduleOnlySections,
        });

        await flushEffects();

        expect(warningSpy).toHaveBeenCalledWith("progress_cache_miss", expect.objectContaining({
          reason: "invalid_shape",
          section: "review_schedule",
        }));
        expect(loadProgressReviewScheduleMock).toHaveBeenCalledWith(buildCurrentReviewScheduleInput());
        expect(harness.getApi().progressSourceState.reviewSchedule.serverBase).toBeNull();

        deferredReviewSchedule.resolve(buildServerReviewSchedule(8, "2026-04-18T09:24:00.000Z"));
        await flushEffects();

        expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.generatedAt).toBe("2026-04-18T09:24:00.000Z");
        expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.buckets[0]?.count).toBe(8);
      } finally {
        warningSpy.mockRestore();
      }
    });
  }

  it("treats cached review schedules for another timezone as misses before loading remote schedule", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deferredReviewSchedule = createDeferredPromise<ProgressReviewSchedule>();
    const reviewScheduleScopeKey = buildCurrentReviewScheduleScopeKey();
    storePersistedProgressReviewScheduleForTest(reviewScheduleScopeKey, {
      ...buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"),
      timeZone: "UTC",
    });
    loadProgressReviewScheduleMock.mockImplementation(() => deferredReviewSchedule.promise);

    try {
      const harness = renderHarness({
        sessionVerificationState: "verified",
        cloudSettings: linkedCloudSettings,
        progressServerInvalidationVersion: 0,
        sections: reviewScheduleOnlySections,
      });

      await flushEffects();

      expect(warningSpy).toHaveBeenCalledWith("progress_cache_miss", expect.objectContaining({
        reason: "time_zone_mismatch",
        section: "review_schedule",
      }));
      expect(harness.getApi().progressSourceState.reviewSchedule.serverBase).toBeNull();

      deferredReviewSchedule.resolve(buildServerReviewSchedule(8, "2026-04-18T09:24:00.000Z"));
      await flushEffects();

      expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.timeZone).toBe("Europe/Madrid");
      expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.buckets[0]?.count).toBe(8);
    } finally {
      warningSpy.mockRestore();
    }
  });
});
