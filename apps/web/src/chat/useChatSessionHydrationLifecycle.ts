import { useCallback, useEffect, useEffectEvent, useRef, type Dispatch } from "react";
import { loadStoredChatConfig } from "./chatConfig";
import { createClientChatSessionId, resolveInitialHydrationSessionId, toErrorMessage } from "./chatSessionControllerHelpers";
import type {
  ChatSessionControllerAction,
  ChatSessionControllerState,
} from "./chatSessionControllerState";
import { isChatSessionStale } from "./chatSessionFreshness";
import {
  loadChatSessionWarmStartSnapshot,
  type WarmStartChatSessionSnapshot,
} from "./chatSessionWarmStart";
import type { ChatHistoryState } from "./useChatHistory";
import type { ChatSessionSnapshotSync } from "./useChatSessionSnapshotSync";

type UseChatSessionHydrationLifecycleParams = Readonly<{
  workspaceId: string | null;
  isRemoteReady: boolean;
  state: ChatSessionControllerState;
  dispatch: Dispatch<ChatSessionControllerAction>;
  history: ChatHistoryState;
  snapshotSync: ChatSessionSnapshotSync;
  initialWarmStartSnapshot: WarmStartChatSessionSnapshot | null;
  initialFreshSessionId: string;
  initialShouldBootstrapFreshLocalSession: boolean;
  ensureFreshSession: (sessionId: string) => void;
}>;

export function useChatSessionHydrationLifecycle(
  params: UseChatSessionHydrationLifecycleParams,
): void {
  const {
    workspaceId,
    isRemoteReady,
    state,
    dispatch,
    history,
    snapshotSync,
    initialWarmStartSnapshot,
    initialFreshSessionId,
    initialShouldBootstrapFreshLocalSession,
    ensureFreshSession,
  } = params;
  const { replaceMessages } = history;
  const {
    detachLiveStream,
    invalidatePendingSnapshotRequests,
    isDocumentVisibleRef,
    loadAndApplySnapshot,
    resetSnapshotTracking,
    runtimeRefs,
    startSnapshotLiveStream,
  } = snapshotSync;
  const hydratedWorkspaceIdRef = useRef<string | null>(initialWarmStartSnapshot?.workspaceId ?? null);
  const shouldBootstrapFreshLocalSessionRef = useRef<boolean>(initialShouldBootstrapFreshLocalSession);

  const applyWarmStartSnapshot = useCallback((nextWorkspaceId: string): boolean => {
    const warmStartSnapshot = loadChatSessionWarmStartSnapshot(nextWorkspaceId);
    if (warmStartSnapshot === null) {
      return false;
    }

    if (isChatSessionStale(warmStartSnapshot.messages, Date.now())) {
      const nextSessionId = createClientChatSessionId();
      detachLiveStream(null, null);
      replaceMessages([]);
      dispatch({
        type: "warm_start_stale",
        sessionId: nextSessionId,
        chatConfig: loadStoredChatConfig(),
      });
      resetSnapshotTracking(null);
      hydratedWorkspaceIdRef.current = nextWorkspaceId;
      shouldBootstrapFreshLocalSessionRef.current = true;
      return true;
    }

    detachLiveStream(null, null);
    replaceMessages(warmStartSnapshot.messages);
    dispatch({
      type: "warm_start_applied",
      sessionId: warmStartSnapshot.sessionId,
      mainContentInvalidationVersion: warmStartSnapshot.mainContentInvalidationVersion,
      chatConfig: warmStartSnapshot.chatConfig,
    });
    resetSnapshotTracking(warmStartSnapshot.updatedAt);
    hydratedWorkspaceIdRef.current = nextWorkspaceId;
    return true;
  }, [detachLiveStream, dispatch, replaceMessages, resetSnapshotTracking]);

  const runHydrationLifecycle = useEffectEvent((isDisposedRef: { current: boolean }): void => {
    const isWorkspaceTransition = hydratedWorkspaceIdRef.current !== workspaceId;

    if (workspaceId === null) {
      invalidatePendingSnapshotRequests();
      detachLiveStream(null, null);
      replaceMessages([]);
      resetSnapshotTracking(null);
      dispatch({ type: "workspace_cleared" });
      hydratedWorkspaceIdRef.current = null;
      return;
    }

    if (isWorkspaceTransition) {
      shouldBootstrapFreshLocalSessionRef.current = false;
    }

    if (shouldBootstrapFreshLocalSessionRef.current) {
      invalidatePendingSnapshotRequests();
      hydratedWorkspaceIdRef.current = workspaceId;
      if (isRemoteReady === false) {
        return;
      }

      shouldBootstrapFreshLocalSessionRef.current = false;
      ensureFreshSession(runtimeRefs.currentSessionIdRef.current ?? initialFreshSessionId);
      dispatch({
        type: "set_history_loaded",
        isHistoryLoaded: true,
      });
      return;
    }

    if (isRemoteReady === false) {
      if (isWorkspaceTransition) {
        const didApplyWarmStartSnapshot = applyWarmStartSnapshot(workspaceId);
        if (didApplyWarmStartSnapshot === false) {
          detachLiveStream(null, null);
          replaceMessages([]);
          resetSnapshotTracking(null);
          dispatch({ type: "workspace_hydration_started" });
          hydratedWorkspaceIdRef.current = workspaceId;
        }
      }
      invalidatePendingSnapshotRequests();
      return;
    }

    if (isWorkspaceTransition) {
      detachLiveStream(null, null);
      replaceMessages([]);
      resetSnapshotTracking(null);
      dispatch({ type: "workspace_hydration_started" });
      hydratedWorkspaceIdRef.current = workspaceId;
    }

    void (async (): Promise<void> => {
      try {
        const snapshot = await loadAndApplySnapshot(
          resolveInitialHydrationSessionId(workspaceId, runtimeRefs.currentSessionIdRef.current),
          true,
          "initial_hydration",
          null,
        );
        if (isDisposedRef.current || snapshot === null) {
          return;
        }

        hydratedWorkspaceIdRef.current = workspaceId;
        if (snapshot.activeRun !== null && isDocumentVisibleRef.current) {
          startSnapshotLiveStream(snapshot, null);
        }
      } catch (error) {
        if (isDisposedRef.current) {
          return;
        }

        if (isWorkspaceTransition && runtimeRefs.messagesRef.current.length === 0) {
          replaceMessages([]);
        }

        dispatch({
          type: "error_shown",
          message: `Chat refresh failed. ${toErrorMessage(error)}`,
        });
      } finally {
        if (isDisposedRef.current === false) {
          dispatch({
            type: "set_history_loaded",
            isHistoryLoaded: true,
          });
        }
      }
    })();
  });

  useEffect(() => {
    const isDisposedRef = { current: false };
    runHydrationLifecycle(isDisposedRef);
    return () => {
      isDisposedRef.current = true;
    };
  }, [isRemoteReady, workspaceId]);

  useEffect(() => {
    if (state.isHistoryLoaded) {
      return;
    }

    if (workspaceId === null) {
      dispatch({
        type: "set_history_loaded",
        isHistoryLoaded: true,
      });
    }
  }, [dispatch, state.isHistoryLoaded, workspaceId]);
}
