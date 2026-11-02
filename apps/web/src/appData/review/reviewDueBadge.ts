import { useEffect, useState } from "react";
import { useAppErrorDialog } from "../../appError/AppErrorContext";
import { isIndexedDbUnavailableError } from "../../localDb/core/indexedDbAvailability";
import { loadReviewDueBadgeSummary } from "../../localDb/reviews/reviews";
import { useAppData } from "../context/provider";

// Browsers fire any longer setTimeout delay immediately; a clamped timer only recomputes and reschedules.
const maxTimeoutDelayMs: number = 2 ** 31 - 1;

export function useReviewDueBadgeCount(): number {
  const { activeWorkspace, localReadVersion, selectedReviewFilter } = useAppData();
  const { indexedDbOpenRecoveryState } = useAppErrorDialog();
  const [dueCount, setDueCount] = useState<number>(0);
  const [refreshVersion, setRefreshVersion] = useState<number>(0);
  const activeWorkspaceId: string | null = activeWorkspace?.workspaceId ?? null;

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
    let nextDueTimeoutId: number | null = null;

    async function refreshDueCount(): Promise<void> {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      if (activeWorkspaceId === null) {
        setDueCount(0);
        return;
      }

      const summary = await loadReviewDueBadgeSummary(activeWorkspaceId, selectedReviewFilter, Date.now());
      if (isCancelled || indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      setDueCount(summary.dueCount);
      if (summary.nextDueAtMillis !== null) {
        const delayMs = Math.min(Math.max(summary.nextDueAtMillis - Date.now(), 0), maxTimeoutDelayMs);
        nextDueTimeoutId = window.setTimeout(() => {
          setRefreshVersion((currentValue) => currentValue + 1);
        }, delayMs);
      }
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
      if (nextDueTimeoutId !== null) {
        window.clearTimeout(nextDueTimeoutId);
      }
    };
  }, [activeWorkspaceId, indexedDbOpenRecoveryState, localReadVersion, refreshVersion, selectedReviewFilter]);

  return dueCount;
}
