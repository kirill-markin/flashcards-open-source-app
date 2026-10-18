import { useCallback, useEffect, useRef, useState } from "react";
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
  aiUsageLoadStatus: "idle" | "loading" | "ready" | "error";
  readHeldAiUsage: () => AiUsageStatus | null;
  refreshAiUsageInBackground: () => void;
}>;

export function useChatAiUsage(params: UseChatAiUsageParams): ChatAiUsage {
  const { indexedDbOpenRecoveryState, workspaceId, isRemoteReady } = params;
  const [aiUsage, setAiUsage] = useState<AiUsageStatus | null>(null);
  const [usageRead, setUsageRead] = useState<Readonly<{
    requestId: number;
    status: ChatAiUsage["aiUsageLoadStatus"];
  }>>({ requestId: 0, status: "idle" });
  const aiUsageRef = useRef<AiUsageStatus | null>(null);
  const latestRequestIdRef = useRef<number>(0);
  const ownerRef = useRef({ workspaceId, isRemoteReady });
  const heldOwnerRef = useRef<string | null>(null);
  if (ownerRef.current.workspaceId !== workspaceId || ownerRef.current.isRemoteReady !== isRemoteReady) {
    latestRequestIdRef.current += 1;
    aiUsageRef.current = null;
    heldOwnerRef.current = null;
    ownerRef.current = { workspaceId, isRemoteReady };
  }

  useEffect(() => () => { latestRequestIdRef.current += 1; }, []);

  const readHeldAiUsage = useCallback((): AiUsageStatus | null =>
    ownerRef.current.isRemoteReady && heldOwnerRef.current === ownerRef.current.workspaceId
      ? aiUsageRef.current : null, []);

  const refreshAiUsageInBackground = useCallback((): void => {
    if (indexedDbOpenRecoveryState.hasFailed() || isRemoteReady === false) {
      return;
    }

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    setUsageRead({ requestId, status: "loading" });
    void (async (): Promise<void> => {
      try {
        const nextAiUsage = await loadAiUsage();
        indexedDbOpenRecoveryState.throwIfFailed();
        if (latestRequestIdRef.current === requestId && ownerRef.current.workspaceId === workspaceId && ownerRef.current.isRemoteReady) {
          heldOwnerRef.current = workspaceId;
          aiUsageRef.current = nextAiUsage;
          setAiUsage(nextAiUsage);
          setUsageRead({ requestId, status: "ready" });
        }
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error) === false) {
          if (latestRequestIdRef.current === requestId && ownerRef.current.workspaceId === workspaceId && ownerRef.current.isRemoteReady) {
            setUsageRead({ requestId, status: "error" });
          }
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
    aiUsage: isRemoteReady && heldOwnerRef.current === workspaceId ? aiUsage : null,
    aiUsageLoadStatus: isRemoteReady && usageRead.requestId === latestRequestIdRef.current ? usageRead.status : "idle",
    readHeldAiUsage,
    refreshAiUsageInBackground,
  };
}
