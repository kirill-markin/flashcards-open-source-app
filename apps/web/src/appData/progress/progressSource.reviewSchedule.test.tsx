// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { ProgressReviewSchedule } from "../../types";
import { invalidateLocalReviewSchedule } from "./progressInvalidation";
import {
  buildCurrentReviewScheduleInput,
  buildServerReviewSchedule,
  calculatePendingProgressReviewScheduleCardTotalDeltaMock,
  createDeferredPromise,
  flushEffects,
  hasCompleteLocalProgressReviewScheduleCoverageMock,
  hasPendingProgressReviewScheduleCardChangesMock,
  linkedCloudSettings,
  linkingReadyCloudSettings,
  loadLocalProgressReviewScheduleMock,
  loadProgressReviewScheduleMock,
  loadProgressSeriesMock,
  loadProgressSummaryMock,
  renderHarness,
  renderInvalidationHarness,
  reviewScheduleOnlySections,
  workspace,
} from "./progressSourceTestSupport";

describe("useProgressSource review schedule", () => {
  it("loads review schedule independently and renders local counts when pending totals reconcile with server", async () => {
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(5);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(7, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, "2026-04-18T09:18:00.000Z"));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).not.toHaveBeenCalled();
    expect(loadProgressSeriesMock).not.toHaveBeenCalled();
    expect(loadLocalProgressReviewScheduleMock).toHaveBeenCalledWith(
      [workspace.workspaceId],
      buildCurrentReviewScheduleInput(),
    );
    expect(calculatePendingProgressReviewScheduleCardTotalDeltaMock).toHaveBeenCalledWith([workspace.workspaceId]);
    expect(loadProgressReviewScheduleMock).toHaveBeenCalledWith(buildCurrentReviewScheduleInput());
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.buckets[0]?.count).toBe(2);
    expect(harness.getApi().progressSourceState.reviewSchedule.pendingLocalCardTotalDelta).toBe(5);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.buckets[0]?.count).toBe(7);
  });

  it("keeps user-wide server review schedule totals when covered local workspaces are only partial", async () => {
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(0);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(8, "2026-04-18T09:18:00.000Z"));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.hasPendingLocalCardChanges).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.hasCompleteLocalCardState).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.pendingLocalCardTotalDelta).toBe(0);
    expect(harness.getApi().progressSourceState.reviewSchedule.localFallback?.totalCards).toBe(4);
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(11);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(11);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.buckets[0]?.count).toBe(8);
  });

  it("keeps server review schedule totals while pending card hot-state coverage is partial", async () => {
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(false);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(7, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, "2026-04-18T09:18:00.000Z"));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(loadLocalProgressReviewScheduleMock).toHaveBeenCalledWith(
      [workspace.workspaceId],
      buildCurrentReviewScheduleInput(),
    );
    expect(hasCompleteLocalProgressReviewScheduleCoverageMock).toHaveBeenCalledWith([workspace.workspaceId]);
    expect(harness.getApi().progressSourceState.reviewSchedule.hasPendingLocalCardChanges).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.hasCompleteLocalCardState).toBe(false);
    expect(harness.getApi().progressSourceState.reviewSchedule.localFallback?.buckets[0]?.count).toBe(7);
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.buckets[0]?.count).toBe(2);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.buckets[0]?.count).toBe(2);
  });

  it("keeps local review schedule fallback when server schedule is unavailable", async () => {
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(false);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(7, null));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkingReadyCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(loadProgressReviewScheduleMock).not.toHaveBeenCalled();
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.buckets[0]?.count).toBe(7);
  });

  it("keeps complete local review schedule rendered after pending sync clears before server refresh succeeds", async () => {
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, "2026-04-18T09:18:00.000Z"));

    const harness = renderInvalidationHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(4);

    const firstRefresh = createDeferredPromise<ProgressReviewSchedule>();
    const secondRefresh = createDeferredPromise<ProgressReviewSchedule>();
    loadProgressReviewScheduleMock.mockReset();
    loadProgressReviewScheduleMock
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(1);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, null));

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    expect(loadProgressReviewScheduleMock).toHaveBeenCalledTimes(1);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(4);

    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(false);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(0);

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.hasPendingLocalCardChanges).toBe(false);
    expect(harness.getApi().progressSourceState.reviewSchedule.pendingLocalCardTotalDelta).toBe(0);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);

    firstRefresh.reject(new Error("Stale review schedule refresh failed"));
    await flushEffects();

    expect(loadProgressReviewScheduleMock).toHaveBeenCalledTimes(2);

    secondRefresh.reject(new Error("Latest review schedule refresh failed"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.errorMessage).toBe("Latest review schedule refresh failed");
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(4);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);
  });

  it("keeps local review schedule after ack when the previous server refresh completed during pending changes", async () => {
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, "2026-04-18T09:18:00.000Z"));

    const harness = renderInvalidationHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    const pendingRefresh = createDeferredPromise<ProgressReviewSchedule>();
    const ackRefresh = createDeferredPromise<ProgressReviewSchedule>();
    loadProgressReviewScheduleMock.mockReset();
    loadProgressReviewScheduleMock
      .mockImplementationOnce(() => pendingRefresh.promise)
      .mockImplementationOnce(() => ackRefresh.promise);
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(1);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, null));

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    pendingRefresh.resolve(buildServerReviewSchedule(1, "2026-04-18T09:19:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(4);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);

    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(false);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(0);

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    expect(loadProgressReviewScheduleMock).toHaveBeenCalledTimes(2);
    expect(harness.getApi().progressSourceState.reviewSchedule.hasPendingLocalCardChanges).toBe(false);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);

    ackRefresh.resolve(buildServerReviewSchedule(2, "2026-04-18T09:20:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(5);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);
  });

  it("keeps complete local review schedule after pull invalidation when the server refresh fails", async () => {
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, "2026-04-18T09:18:00.000Z"));

    const harness = renderInvalidationHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(4);

    const refresh = createDeferredPromise<ProgressReviewSchedule>();
    loadProgressReviewScheduleMock.mockReset();
    loadProgressReviewScheduleMock.mockImplementation(() => refresh.promise);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, null));

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.hasPendingLocalCardChanges).toBe(false);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);

    refresh.reject(new Error("Pulled review schedule refresh failed"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.errorMessage).toBe("Pulled review schedule refresh failed");
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(4);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);
  });

  it("keeps stale server review schedule when local totals never reconciled with server totals", async () => {
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(8, "2026-04-18T09:18:00.000Z"));

    const harness = renderInvalidationHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.localFallback?.totalCards).toBe(4);
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(11);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(11);

    const refresh = createDeferredPromise<ProgressReviewSchedule>();
    loadProgressReviewScheduleMock.mockReset();
    loadProgressReviewScheduleMock.mockImplementation(() => refresh.promise);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, null));

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.localFallback?.totalCards).toBe(5);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(11);

    refresh.reject(new Error("Review schedule refresh failed"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.errorMessage).toBe("Review schedule refresh failed");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(11);
  });
});
