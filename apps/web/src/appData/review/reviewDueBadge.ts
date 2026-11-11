import { useEffect, useRef, useState } from "react";
import { useAppErrorDialog } from "../../appError/AppErrorContext";
import { isIndexedDbUnavailableError } from "../../localDb/core/indexedDbAvailability";
import { loadReviewDueBadgeSummary, type ReviewDueBadgeSummary } from "../../localDb/reviews/reviews";
import { useAppData } from "../context/provider";
import type { LocalReview } from "../context/types";
import {
  delayUntilNextDueMillis,
  dueCountAfterLocalReview,
  nextDueAtMillisAfterLocalReview,
  reviewCountsRepairDelay,
} from "./localReviewSchedule";

type WorkspaceReviewDueBadgeSummary = ReviewDueBadgeSummary & Readonly<{ workspaceId: string }>;

export function useReviewDueBadgeCount(): number {
  const { activeWorkspace, lastLocalReview, localReadVersion } = useAppData();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const [summary, setSummary] = useState<WorkspaceReviewDueBadgeSummary | null>(null);
  const [refreshVersion, setRefreshVersion] = useState<number>(0);
  const observedLocalReviewRef = useRef<LocalReview | null>(lastLocalReview);
  // Moves on every local rating; a load that overlapped one may hold a summary from before that rating.
  const localReviewSequenceRef = useRef<number>(0);
  const isCountsRepairNeededRef = useRef<boolean>(false);
  const countsRepairTimeoutIdRef = useRef<number | null>(null);
  // A past due time whose scan already started; until a scan applies, a dropped scan's repair owns it, so
  // local patches that keep it never rescan once per rating: docs/fsrs-scheduling-logic.md#non-blocking-review
  const scannedPastNextDueAtMillisRef = useRef<number | null>(null);
  const activeWorkspaceId: string | null = activeWorkspace?.workspaceId ?? null;
  const activeSummary = summary?.workspaceId === activeWorkspaceId ? summary : null;

  function clearCountsRepairTimer(): void {
    if (countsRepairTimeoutIdRef.current !== null) {
      window.clearTimeout(countsRepairTimeoutIdRef.current);
      countsRepairTimeoutIdRef.current = null;
    }
  }

  // A summary dropped for overlapping a rating is rescanned once ratings pause; each rating restarts the wait.
  function restartCountsRepairTimer(): void {
    clearCountsRepairTimer();
    if (isCountsRepairNeededRef.current === false) {
      return;
    }

    countsRepairTimeoutIdRef.current = window.setTimeout(() => {
      countsRepairTimeoutIdRef.current = null;
      isCountsRepairNeededRef.current = false;
      setRefreshVersion((currentValue) => currentValue + 1);
    }, reviewCountsRepairDelay);
  }

  useEffect(() => {
    setSummary(null);
    isCountsRepairNeededRef.current = false;
    scannedPastNextDueAtMillisRef.current = null;
    return clearCountsRepairTimer;
  }, [activeWorkspaceId]);

  useEffect(() => {
    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        setRefreshVersion((currentValue) => currentValue + 1);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function refreshDueCount(): Promise<void> {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      if (activeWorkspaceId === null) {
        return;
      }

      const localReviewSequenceAtStart = localReviewSequenceRef.current;
      const nextSummary = await loadReviewDueBadgeSummary(activeWorkspaceId, Date.now());
      if (isCancelled || indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }
      // The in-memory patch keeps the badge right meanwhile: docs/fsrs-scheduling-logic.md#non-blocking-review
      if (localReviewSequenceRef.current !== localReviewSequenceAtStart) {
        isCountsRepairNeededRef.current = true;
        restartCountsRepairTimer();
        return;
      }

      isCountsRepairNeededRef.current = false;
      clearCountsRepairTimer();
      scannedPastNextDueAtMillisRef.current = null;
      setSummary({ ...nextSummary, workspaceId: activeWorkspaceId });
    }

    void refreshDueCount().catch((error: unknown): void => {
      indexedDbOpenRecoveryState.markFailed(error);
      // A missing IndexedDB factory already shows the storage-unavailable screen, as for the local card count.
      if (indexedDbOpenRecoveryState.hasFailed() || isIndexedDbUnavailableError(error)) {
        return;
      }

      throw error;
    });

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspaceId, indexedDbOpenRecoveryState, localReadVersion, refreshVersion]);

  useEffect(() => {
    const nextDueAtMillis = activeSummary?.nextDueAtMillis ?? null;
    if (nextDueAtMillis === null || nextDueAtMillis === scannedPastNextDueAtMillisRef.current) {
      return undefined;
    }

    const nextDueTimeoutId = window.setTimeout(() => {
      // A clamped timeout fires before the due time and must re-arm after the scan applies the same value.
      if (nextDueAtMillis <= Date.now()) {
        scannedPastNextDueAtMillisRef.current = nextDueAtMillis;
      }
      setRefreshVersion((currentValue) => currentValue + 1);
    }, delayUntilNextDueMillis(nextDueAtMillis, Date.now()));
    return () => {
      window.clearTimeout(nextDueTimeoutId);
    };
    // Every new summary re-arms, so an unchanged due time after a clamped timeout still gets a timer.
  }, [activeSummary]);

  // A local rating patches the badge in memory: docs/fsrs-scheduling-logic.md#non-blocking-review
  useEffect(() => {
    if (lastLocalReview === observedLocalReviewRef.current) {
      return;
    }

    observedLocalReviewRef.current = lastLocalReview;
    if (lastLocalReview === null || lastLocalReview.workspaceId !== activeWorkspaceId) {
      return;
    }

    localReviewSequenceRef.current += 1;
    restartCountsRepairTimer();
    const nowTimestamp = Date.now();
    setSummary((currentSummary) => currentSummary?.workspaceId !== activeWorkspaceId ? currentSummary : {
      workspaceId: activeWorkspaceId,
      dueCount: dueCountAfterLocalReview(currentSummary.dueCount),
      nextDueAtMillis: nextDueAtMillisAfterLocalReview(
        currentSummary.nextDueAtMillis,
        lastLocalReview.reviewedCard,
        nowTimestamp,
      ),
    });
  }, [activeWorkspaceId, lastLocalReview]);

  return activeSummary?.dueCount ?? 0;
}
