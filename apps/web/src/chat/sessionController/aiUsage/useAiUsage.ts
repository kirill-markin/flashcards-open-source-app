import { useCallback, useRef, useState } from "react";
import { loadAiUsage } from "../../../api";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
} from "../../../appError/AppErrorContext";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import type { AiUsageStatus } from "../../../types";

type UseChatAiUsageParams = Readonly<{
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  workspaceId: string | null;
  isRemoteReady: boolean;
}>;

export type ChatAiUsage = Readonly<{
  aiUsage: AiUsageStatus | null;
  readHeldAiUsage: () => AiUsageStatus | null;
  refreshAiUsageInBackground: () => void;
}>;

/**
 * This month's AI usage as the chat last read it. Only the newest request may replace it, so a slow
 * earlier response cannot bring back a larger remaining count after a later one. A failed load is
 * reported here, and the chat keeps the last usage it read.
 */
export function useChatAiUsage(params: UseChatAiUsageParams): ChatAiUsage {
  const { indexedDbOpenRecoveryState, workspaceId, isRemoteReady } = params;
  const [aiUsage, setAiUsage] = useState<AiUsageStatus | null>(null);
  const aiUsageRef = useRef<AiUsageStatus | null>(null);
  const latestRequestIdRef = useRef<number>(0);

  const readHeldAiUsage = useCallback((): AiUsageStatus | null => aiUsageRef.current, []);

  const refreshAiUsageInBackground = useCallback((): void => {
    if (indexedDbOpenRecoveryState.hasFailed() || isRemoteReady === false) {
      return;
    }

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    void (async (): Promise<void> => {
      try {
        const nextAiUsage = await loadAiUsage();
        indexedDbOpenRecoveryState.throwIfFailed();
        if (latestRequestIdRef.current === requestId) {
          aiUsageRef.current = nextAiUsage;
          setAiUsage(nextAiUsage);
        }
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error) === false) {
          captureAppOperationError(error, {
            feature: "chat",
            operation: "ai_usage_load",
            userId: null,
            workspaceId,
            installationId: null,
            entityId: null,
          });
        }
      }
    })();
  }, [indexedDbOpenRecoveryState, isRemoteReady, workspaceId]);

  return {
    aiUsage,
    readHeldAiUsage,
    refreshAiUsageInBackground,
  };
}
