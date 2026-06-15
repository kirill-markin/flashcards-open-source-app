// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildCurrentSeriesInput,
  buildDailyReviewPoint,
  buildGoodDailyReviewPoint,
  buildServerSeries,
  buildServerSummary,
  createDeferredPromise,
  flushEffects,
  hasPendingProgressReviewEventsMock,
  linkedCloudSettings,
  loadLocalProgressActiveDatesMock,
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
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual(expect.objectContaining({
      date: buildCurrentSeriesInput().to,
      reviewCount: 1,
    }));
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
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual(expect.objectContaining({
      date: buildCurrentSeriesInput().to,
      reviewCount: 3,
    }));

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
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(8);
  });

  it("keeps reviewed-today summary visible after pending uploads clear before the server summary catches up", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    hasPendingProgressReviewEventsMock.mockResolvedValue(false);
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: {
        currentStreakDays: 1,
        hasReviewedToday: false,
        lastReviewedOn: "2026-04-19",
        activeReviewDays: 7,
      },
    });
    loadProgressSeriesMock.mockResolvedValue({
      timeZone: currentSeriesInput.timeZone,
      from: currentSeriesInput.from,
      to: currentSeriesInput.to,
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      dailyReviews: [
        buildGoodDailyReviewPoint(currentSeriesInput.to, 0),
      ],
    });
    loadLocalProgressSummaryMock.mockResolvedValue({
      currentStreakDays: 2,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-20",
      activeReviewDays: 8,
    });
    loadLocalProgressDailyReviewsMock.mockResolvedValue([
      buildDailyReviewPoint(currentSeriesInput.to, 1, 1, 0, 0, 0),
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase?.summary.hasReviewedToday).toBe(false);
    expect(harness.getApi().progressSourceState.summary.hasPendingLocalReviews).toBe(false);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual({
      currentStreakDays: 2,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-20",
      activeReviewDays: 8,
    });
    expect(harness.getApi().progressSourceState.series.serverBase?.dailyReviews).toContainEqual(expect.objectContaining({
      date: currentSeriesInput.to,
      reviewCount: 0,
    }));
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 1,
      againCount: 1,
      hardCount: 0,
      goodCount: 0,
      easyCount: 0,
    });
  });

  it("extends a long server streak when local review history adds today", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: {
        currentStreakDays: 200,
        hasReviewedToday: false,
        lastReviewedOn: "2026-04-19",
        activeReviewDays: 200,
      },
    });
    loadProgressSeriesMock.mockResolvedValue({
      timeZone: currentSeriesInput.timeZone,
      from: currentSeriesInput.from,
      to: currentSeriesInput.to,
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      dailyReviews: [
        buildGoodDailyReviewPoint("2026-04-19", 1),
      ],
    });
    loadLocalProgressSummaryMock.mockResolvedValue({
      currentStreakDays: 1,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-20",
      activeReviewDays: 1,
    });
    loadLocalProgressActiveDatesMock.mockResolvedValue(["2026-04-20"]);
    loadLocalProgressDailyReviewsMock.mockResolvedValue([
      buildGoodDailyReviewPoint("2026-04-20", 1),
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual({
      currentStreakDays: 201,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-20",
      activeReviewDays: 201,
    });
  });

  it("extends a long server streak through consecutive local active dates", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: {
        currentStreakDays: 200,
        hasReviewedToday: false,
        lastReviewedOn: "2026-04-18",
        activeReviewDays: 200,
      },
    });
    loadProgressSeriesMock.mockResolvedValue({
      timeZone: currentSeriesInput.timeZone,
      from: currentSeriesInput.from,
      to: currentSeriesInput.to,
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      dailyReviews: [
        buildGoodDailyReviewPoint("2026-04-18", 1),
      ],
    });
    loadLocalProgressSummaryMock.mockResolvedValue({
      currentStreakDays: 2,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-20",
      activeReviewDays: 2,
    });
    loadLocalProgressActiveDatesMock.mockResolvedValue([
      "2026-04-19",
      "2026-04-20",
    ]);
    loadLocalProgressDailyReviewsMock.mockResolvedValue([
      buildGoodDailyReviewPoint("2026-04-19", 1),
      buildGoodDailyReviewPoint("2026-04-20", 1),
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual({
      currentStreakDays: 202,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-20",
      activeReviewDays: 202,
    });
  });

  it("adds local active dates after server last reviewed even outside the visible chart range", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: {
        currentStreakDays: 0,
        hasReviewedToday: false,
        lastReviewedOn: "2025-11-15",
        activeReviewDays: 200,
      },
    });
    loadProgressSeriesMock.mockResolvedValue({
      timeZone: currentSeriesInput.timeZone,
      from: currentSeriesInput.from,
      to: currentSeriesInput.to,
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      dailyReviews: [],
    });
    loadLocalProgressSummaryMock.mockResolvedValue({
      currentStreakDays: 0,
      hasReviewedToday: false,
      lastReviewedOn: "2025-11-16",
      activeReviewDays: 1,
    });
    loadLocalProgressActiveDatesMock.mockResolvedValue(["2025-11-16"]);
    loadLocalProgressDailyReviewsMock.mockResolvedValue([]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual({
      currentStreakDays: 0,
      hasReviewedToday: false,
      lastReviewedOn: "2025-11-16",
      activeReviewDays: 201,
    });
  });

  it("does not double-count today when server summary already includes it", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: {
        currentStreakDays: 200,
        hasReviewedToday: true,
        lastReviewedOn: "2026-04-20",
        activeReviewDays: 200,
      },
    });
    loadProgressSeriesMock.mockResolvedValue({
      timeZone: currentSeriesInput.timeZone,
      from: currentSeriesInput.from,
      to: currentSeriesInput.to,
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      dailyReviews: [
        buildGoodDailyReviewPoint("2026-04-20", 1),
      ],
    });
    loadLocalProgressSummaryMock.mockResolvedValue({
      currentStreakDays: 1,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-20",
      activeReviewDays: 1,
    });
    loadLocalProgressActiveDatesMock.mockResolvedValue(["2026-04-20"]);
    loadLocalProgressDailyReviewsMock.mockResolvedValue([
      buildGoodDailyReviewPoint("2026-04-20", 1),
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.isApproximate).toBe(false);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual({
      currentStreakDays: 200,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-20",
      activeReviewDays: 200,
    });
  });

  it("keeps disjoint visible server and local days consistent between chart and summary", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: {
        currentStreakDays: 0,
        hasReviewedToday: false,
        lastReviewedOn: "2026-04-18",
        activeReviewDays: 200,
      },
    });
    loadProgressSeriesMock.mockResolvedValue({
      timeZone: currentSeriesInput.timeZone,
      from: currentSeriesInput.from,
      to: currentSeriesInput.to,
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      dailyReviews: [
        buildGoodDailyReviewPoint("2026-04-18", 1),
      ],
    });
    loadLocalProgressSummaryMock.mockResolvedValue({
      currentStreakDays: 1,
      hasReviewedToday: false,
      lastReviewedOn: "2026-04-19",
      activeReviewDays: 1,
    });
    loadLocalProgressActiveDatesMock.mockResolvedValue(["2026-04-19"]);
    loadLocalProgressDailyReviewsMock.mockResolvedValue([
      buildDailyReviewPoint("2026-04-19", 1, 0, 1, 0, 0),
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual({
      currentStreakDays: 2,
      hasReviewedToday: false,
      lastReviewedOn: "2026-04-19",
      activeReviewDays: 201,
    });
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual(expect.objectContaining({
      date: "2026-04-18",
      reviewCount: 1,
    }));
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: "2026-04-19",
      reviewCount: 1,
      againCount: 0,
      hardCount: 1,
      goodCount: 0,
      easyCount: 0,
    });
  });

  it("renders server series with pending local review overlay as approximate", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    loadProgressSeriesMock.mockResolvedValue(buildServerSeries(4, "2026-04-18T09:18:00.000Z"));
    loadPendingProgressDailyReviewsMock.mockResolvedValue([
      buildDailyReviewPoint(currentSeriesInput.to, 3, 1, 1, 0, 1),
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: seriesOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.series.serverBase?.dailyReviews).toContainEqual(expect.objectContaining({
      date: currentSeriesInput.to,
      reviewCount: 4,
    }));
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 7,
      againCount: 1,
      hardCount: 1,
      goodCount: 4,
      easyCount: 1,
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
    expect(loadLocalProgressActiveDatesMock).toHaveBeenCalledTimes(1);
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
