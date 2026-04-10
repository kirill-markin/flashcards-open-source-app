import { useCallback, useEffect, useEffectEvent, useRef, type Dispatch } from "react";
import type { Locale } from "../../i18n/types";
import { loadStoredChatConfig } from "./config";
import type {
  ChatSessionControllerAction,
  ChatSessionControllerState,
} from "./state";
import {
  createClientChatSessionId,
  resolveInitialHydrationSessionId,
  toErrorMessage,
} from "./helpers";
import { isChatSessionStale } from "./freshness";
import type { ChatSessionSnapshotSync } from "./useSnapshotSync";
import {
  loadChatSessionWarmStartSnapshot,
  type WarmStartChatSessionSnapshot,
} from "./warmStart";
import type { ChatHistoryState } from "../useChatHistory";
import type { ChatSessionControllerUiMessages } from "./types";

type UseChatSessionHydrationLifecycleParams = Readonly<{
  workspaceId: string | null;
  isRemoteReady: boolean;
  uiLocale: Locale;
  uiMessages: ChatSessionControllerUiMessages;
  state: ChatSessionControllerState;
  dispatch: Dispatch<ChatSessionControllerAction>;
  history: ChatHistoryState;
  snapshotSync: ChatSessionSnapshotSync;
  initialWarmStartSnapshot: WarmStartChatSessionSnapshot | null;
  initialFreshSessionId: string;
  initialShouldBootstrapFreshLocalSession: boolean;
  ensureRemoteSessionForHydration: () => Promise<string>;
  ensureFreshSession: (sessionId: string, requestSequence: number) => void;
  getFreshSessionRequestSequence: () => number;
}>;

export function useChatSessionHydrationLifecycle(
  params: UseChatSessionHydrationLifecycleParams,
): void {
  const {
    workspaceId,
    isRemoteReady,
    uiLocale,
    uiMessages,
    state,
    dispatch,
    history,
    snapshotSync,
    initialWarmStartSnapshot,
    initialFreshSessionId,
    initialShouldBootstrapFreshLocalSession,
    ensureRemoteSessionForHydration,
    ensureFreshSession,
    getFreshSessionRequestSequence,
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
  const hydratedUiLocaleRef = useRef<Locale | null>(workspaceId === null ? null : uiLocale);
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
      hydratedUiLocaleRef.current = uiLocale;
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
      pendingToolRunPostSync: warmStartSnapshot.pendingToolRunPostSync,
    });
    resetSnapshotTracking(warmStartSnapshot.updatedAt);
    hydratedWorkspaceIdRef.current = nextWorkspaceId;
    hydratedUiLocaleRef.current = uiLocale;
    return true;
  }, [detachLiveStream, dispatch, replaceMessages, resetSnapshotTracking, uiLocale]);

  const runHydrationLifecycle = useEffectEvent((isDisposedRef: { current: boolean }): void => {
    const isWorkspaceTransition = hydratedWorkspaceIdRef.current !== workspaceId;
    const isLocaleTransition = isWorkspaceTransition === false
      && workspaceId !== null
      && hydratedUiLocaleRef.current !== uiLocale;
    const initialHydrationSessionId = isWorkspaceTransition
      ? null
      : resolveInitialHydrationSessionId(workspaceId, runtimeRefs.currentSessionIdRef.current);

    if (workspaceId === null) {
      invalidatePendingSnapshotRequests();
      detachLiveStream(null, null);
      replaceMessages([]);
      resetSnapshotTracking(null);
      runtimeRefs.currentWorkspaceIdRef.current = null;
      runtimeRefs.currentSessionIdRef.current = null;
      dispatch({ type: "workspace_cleared" });
      hydratedWorkspaceIdRef.current = null;
      hydratedUiLocaleRef.current = null;
      return;
    }

    if (isWorkspaceTransition) {
      shouldBootstrapFreshLocalSessionRef.current = false;
    }

    if (isLocaleTransition) {
      hydratedUiLocaleRef.current = uiLocale;
      const currentSessionId = runtimeRefs.currentSessionIdRef.current ?? initialFreshSessionId;
      const shouldRefreshIdleFreshSession = state.isHistoryLoaded
        && runtimeRefs.messagesRef.current.length === 0
        && runtimeRefs.runStateRef.current === "idle";

      if (shouldRefreshIdleFreshSession === false) {
        return;
      }

      invalidatePendingSnapshotRequests();
      dispatch({
        type: "fresh_session_requested",
        sessionId: currentSessionId,
        chatConfig: loadStoredChatConfig(),
      });
      if (isRemoteReady) {
        ensureFreshSession(currentSessionId, getFreshSessionRequestSequence());
      }
      return;
    }

    if (shouldBootstrapFreshLocalSessionRef.current) {
      invalidatePendingSnapshotRequests();
      hydratedWorkspaceIdRef.current = workspaceId;
      hydratedUiLocaleRef.current = uiLocale;
      if (isRemoteReady === false) {
        return;
      }

      shouldBootstrapFreshLocalSessionRef.current = false;
      ensureFreshSession(
        runtimeRefs.currentSessionIdRef.current ?? initialFreshSessionId,
        0,
      );
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
          runtimeRefs.currentWorkspaceIdRef.current = workspaceId;
          runtimeRefs.currentSessionIdRef.current = null;
          dispatch({ type: "workspace_hydration_started" });
          hydratedWorkspaceIdRef.current = workspaceId;
          hydratedUiLocaleRef.current = uiLocale;
        }
      }
      invalidatePendingSnapshotRequests();
      return;
    }

    if (isWorkspaceTransition) {
      detachLiveStream(null, null);
      replaceMessages([]);
      resetSnapshotTracking(null);
      runtimeRefs.currentWorkspaceIdRef.current = workspaceId;
      runtimeRefs.currentSessionIdRef.current = null;
      dispatch({ type: "workspace_hydration_started" });
      hydratedWorkspaceIdRef.current = workspaceId;
      hydratedUiLocaleRef.current = uiLocale;
    }

    void (async (): Promise<void> => {
      try {
        const ensuredSessionId = initialHydrationSessionId ?? await ensureRemoteSessionForHydration();
        const snapshot = await loadAndApplySnapshot(
          ensuredSessionId,
          true,
          "initial_hydration",
          null,
        );
        if (isDisposedRef.current || snapshot === null) {
          return;
        }

        hydratedWorkspaceIdRef.current = workspaceId;
        hydratedUiLocaleRef.current = uiLocale;
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
          message: `${uiMessages.refreshFailedPrefix} ${toErrorMessage(error, uiMessages.errorFallbacks)}`,
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
  }, [isRemoteReady, uiLocale, workspaceId]);

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
