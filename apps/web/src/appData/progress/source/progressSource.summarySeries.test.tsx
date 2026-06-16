// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { DailyReviewPoint, ProgressSummary, StreakFreeze } from "../../../types";
import { shiftLocalDate } from "../../../progress/progressDates";
import { createDefaultStreakFreeze } from "../../../progress/streakFreeze";
import {
  buildCurrentSeriesInput,
  buildDailyReviewPoint,
  buildGoodDailyReviewPoint,
  buildServerSeries,
  buildServerSeriesWithDailyReviews,
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

function createProgressSummary(
  currentStreakDays: number,
  hasReviewedToday: boolean,
  lastReviewedOn: string | null,
  activeReviewDays: number,
): ProgressSummary {
  return createProgressSummaryWithFreeze(
    currentStreakDays,
    hasReviewedToday,
    lastReviewedOn,
    activeReviewDays,
    createDefaultStreakFreeze(),
  );
}

function createProgressSummaryWithFreeze(
  currentStreakDays: number,
  hasReviewedToday: boolean,
  lastReviewedOn: string | null,
  activeReviewDays: number,
  streakFreeze: StreakFreeze,
): ProgressSummary {
  return {
    currentStreakDays,
    longestStreakDays: currentStreakDays,
    hasReviewedToday,
    lastReviewedOn,
    activeReviewDays,
    streakFreeze,
  };
}

function createDailyReviewsForRange(from: string, to: string): ReadonlyArray<DailyReviewPoint> {
  const dailyReviews: Array<DailyReviewPoint> = [];

  for (let currentDate = from; currentDate <= to; currentDate = shiftLocalDate(currentDate, 1)) {
    dailyReviews.push(buildGoodDailyReviewPoint(currentDate, 1));
  }

  return dailyReviews;
}

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
    loadLocalProgressSummaryMock.mockResolvedValue(createProgressSummary(2, true, "2026-04-18", 8));

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
      summary: createProgressSummary(1, false, "2026-04-19", 7),
    });
    loadProgressSeriesMock.mockResolvedValue(buildServerSeriesWithDailyReviews([
      buildGoodDailyReviewPoint(currentSeriesInput.to, 0),
    ], "2026-04-20T09:15:00.000Z"));
    loadLocalProgressSummaryMock.mockResolvedValue(createProgressSummary(2, true, "2026-04-20", 8));
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
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual(
      createProgressSummary(2, true, "2026-04-20", 8),
    );
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
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: createProgressSummary(200, false, "2026-04-19", 200),
    });
    loadProgressSeriesMock.mockResolvedValue(buildServerSeriesWithDailyReviews([
      buildGoodDailyReviewPoint("2026-04-19", 1),
    ], "2026-04-20T09:15:00.000Z"));
    loadLocalProgressSummaryMock.mockResolvedValue(createProgressSummary(1, true, "2026-04-20", 1));
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
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual(
      createProgressSummary(201, true, "2026-04-20", 201),
    );
  });

  it("extends a long server streak through consecutive local active dates", async () => {
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: createProgressSummary(201, false, "2026-04-18", 200),
    });
    loadProgressSeriesMock.mockResolvedValue(buildServerSeriesWithDailyReviews([
      buildGoodDailyReviewPoint("2026-04-18", 1),
    ], "2026-04-20T09:15:00.000Z"));
    loadLocalProgressSummaryMock.mockResolvedValue(createProgressSummary(2, true, "2026-04-20", 2));
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

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual(
      createProgressSummary(202, true, "2026-04-20", 202),
    );
  });

  it("adds local active dates after server last reviewed even outside the visible chart range", async () => {
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: createProgressSummary(0, false, "2025-11-15", 200),
    });
    loadProgressSeriesMock.mockResolvedValue(buildServerSeriesWithDailyReviews([], "2026-04-20T09:15:00.000Z"));
    loadLocalProgressSummaryMock.mockResolvedValue(createProgressSummary(0, false, "2025-11-16", 1));
    loadLocalProgressActiveDatesMock.mockResolvedValue(["2025-11-16"]);
    loadLocalProgressDailyReviewsMock.mockResolvedValue([]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual(
      createProgressSummary(0, false, "2025-11-16", 201),
    );
  });

  it("does not double-count today when server summary already includes it", async () => {
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: createProgressSummary(200, true, "2026-04-20", 200),
    });
    loadProgressSeriesMock.mockResolvedValue(buildServerSeriesWithDailyReviews([
      buildGoodDailyReviewPoint("2026-04-20", 1),
    ], "2026-04-20T09:15:00.000Z"));
    loadLocalProgressSummaryMock.mockResolvedValue(createProgressSummary(1, true, "2026-04-20", 1));
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
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual(
      createProgressSummary(200, true, "2026-04-20", 200),
    );
  });

  it("keeps disjoint visible server and local days consistent between chart and summary", async () => {
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: createProgressSummary(2, false, "2026-04-18", 200),
    });
    loadProgressSeriesMock.mockResolvedValue(buildServerSeriesWithDailyReviews([
      buildGoodDailyReviewPoint("2026-04-18", 1),
    ], "2026-04-20T09:15:00.000Z"));
    loadLocalProgressSummaryMock.mockResolvedValue(createProgressSummary(1, false, "2026-04-19", 1));
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

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary).toEqual(
      createProgressSummary(2, false, "2026-04-19", 201),
    );
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

  it("preserves server freeze states when pending local reviews overlay a later day", async () => {
    const serverSeries = buildServerSeriesWithDailyReviews([
      buildGoodDailyReviewPoint("2026-04-16", 1),
    ], "2026-04-18T09:18:00.000Z");
    loadProgressSeriesMock.mockResolvedValue(serverSeries);
    loadLocalProgressActiveDatesMock.mockResolvedValue(["2026-04-16", "2026-04-18"]);
    loadPendingProgressDailyReviewsMock.mockResolvedValue([
      buildGoodDailyReviewPoint("2026-04-18", 1),
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: seriesOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.streakDays).toContainEqual({
      date: "2026-04-18",
      state: "reviewed",
    });
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.streakDays).toContainEqual({
      date: "2026-04-19",
      state: "frozen",
    });
    expect(serverSeries.streakDays).toContainEqual({
      date: "2026-04-19",
      state: "missed",
    });
  });

  it("keeps server carry-in streak states before a local review overlay", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    const localReviewDate = "2026-04-18";
    const serverSeries = buildServerSeriesWithDailyReviews([], "2026-04-18T09:18:00.000Z");
    loadProgressSeriesMock.mockResolvedValue({
      ...serverSeries,
      streakDays: serverSeries.streakDays.map((day) => (
        day.date === currentSeriesInput.from
          ? {
            date: day.date,
            state: "frozen",
          }
          : day
      )),
    });
    loadLocalProgressActiveDatesMock.mockResolvedValue([localReviewDate]);
    loadLocalProgressDailyReviewsMock.mockResolvedValue([
      buildGoodDailyReviewPoint(localReviewDate, 1),
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: seriesOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.streakDays).toContainEqual({
      date: currentSeriesInput.from,
      state: "frozen",
    });
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.streakDays).toContainEqual({
      date: localReviewDate,
      state: "reviewed",
    });
  });

  it("recomputes visible carry-in streak states when a local review replaces a frozen day", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    const localReviewDate = "2026-04-17";
    const serverSeries = buildServerSeriesWithDailyReviews(
      createDailyReviewsForRange(currentSeriesInput.from, "2026-04-16"),
      "2026-04-18T09:18:00.000Z",
    );
    loadProgressSeriesMock.mockResolvedValue(serverSeries);
    loadLocalProgressActiveDatesMock.mockResolvedValue([localReviewDate]);
    loadLocalProgressDailyReviewsMock.mockResolvedValue([
      buildGoodDailyReviewPoint(localReviewDate, 1),
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: seriesOnlySections,
    });

    await flushEffects();

    expect(serverSeries.streakDays).toContainEqual({
      date: "2026-04-19",
      state: "missed",
    });
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.streakDays).toContainEqual({
      date: localReviewDate,
      state: "reviewed",
    });
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.streakDays).toContainEqual({
      date: "2026-04-19",
      state: "frozen",
    });
  });

  it("builds local-only streak states from all local active dates", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    loadLocalProgressActiveDatesMock.mockResolvedValue([
      shiftLocalDate(currentSeriesInput.from, -1),
    ]);

    const harness = renderHarness({
      sessionVerificationState: "unverified",
      cloudSettings: null,
      progressServerInvalidationVersion: 0,
      sections: seriesOnlySections,
    });

    await flushEffects();

    expect(loadProgressSeriesMock).not.toHaveBeenCalled();
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.streakDays).toContainEqual({
      date: currentSeriesInput.from,
      state: "frozen",
    });
  });

  it("marks server series approximate when local carry-in changes only streak states", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    const localCarryInDate = shiftLocalDate(currentSeriesInput.from, -1);
    loadProgressSeriesMock.mockResolvedValue(buildServerSeriesWithDailyReviews([], "2026-04-18T09:18:00.000Z"));
    loadLocalProgressActiveDatesMock.mockResolvedValue([localCarryInDate]);
    loadLocalProgressDailyReviewsMock.mockResolvedValue([]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: seriesOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual(expect.objectContaining({
      date: currentSeriesInput.from,
      reviewCount: 0,
    }));
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.streakDays).toContainEqual({
      date: currentSeriesInput.from,
      state: "frozen",
    });
  });

  it("keeps the server freeze bank when a local lower bound ties server streak length", async () => {
    const staleServerFreeze: StreakFreeze = {
      availableCredits: 1,
      capacity: 2,
      balanceUnits: 10,
      unitsPerCredit: 10,
      nextCreditProgressUnits: 0,
      nextCreditRequiredUnits: 10,
    };
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: createProgressSummaryWithFreeze(2, false, "2026-04-19", 8, staleServerFreeze),
    });
    loadLocalProgressSummaryMock.mockResolvedValue(createProgressSummary(2, false, "2026-04-19", 8));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.streakFreeze).toEqual(
      staleServerFreeze,
    );
  });

  it("uses exact series freeze overlay for multi-day local review deltas", async () => {
    const sharedWatermark = [
      { workspaceId: "workspace-1", reviewSequenceId: 42 },
    ];
    const staleServerFreeze: StreakFreeze = {
      availableCredits: 1,
      capacity: 2,
      balanceUnits: 11,
      unitsPerCredit: 10,
      nextCreditProgressUnits: 1,
      nextCreditRequiredUnits: 10,
    };
    const serverSeries = {
      ...buildServerSeriesWithDailyReviews([
        buildGoodDailyReviewPoint("2026-04-18", 1),
      ], "2026-04-20T09:15:00.000Z"),
      reviewHistoryWatermarks: sharedWatermark,
    };
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: sharedWatermark,
      summary: createProgressSummaryWithFreeze(2, false, "2026-04-18", 200, staleServerFreeze),
    });
    loadProgressSeriesMock.mockResolvedValue(serverSeries);
    loadLocalProgressSummaryMock.mockResolvedValue(createProgressSummary(2, true, "2026-04-20", 2));
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

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.currentStreakDays).toBe(3);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.streakFreeze).toEqual(
      createDefaultStreakFreeze(),
    );
  });

  it("uses exact summary-only freeze overlay for multi-day local review deltas", async () => {
    const staleServerFreeze: StreakFreeze = {
      availableCredits: 1,
      capacity: 2,
      balanceUnits: 10,
      unitsPerCredit: 10,
      nextCreditProgressUnits: 0,
      nextCreditRequiredUnits: 10,
    };
    loadProgressSummaryMock.mockResolvedValue({
      timeZone: "Europe/Madrid",
      generatedAt: "2026-04-20T09:15:00.000Z",
      reviewHistoryWatermarks: [
        { workspaceId: "workspace-1", reviewSequenceId: 42 },
      ],
      summary: createProgressSummaryWithFreeze(200, false, "2026-04-18", 200, staleServerFreeze),
    });
    loadLocalProgressSummaryMock.mockResolvedValue(createProgressSummary(2, true, "2026-04-20", 2));
    loadLocalProgressActiveDatesMock.mockResolvedValue([
      "2026-04-19",
      "2026-04-20",
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.currentStreakDays).toBe(201);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.streakFreeze).toEqual(
      createDefaultStreakFreeze(),
    );
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
      localFallbackActiveDates: [],
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
