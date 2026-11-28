import { useCallback, useEffect, useEffectEvent, useReducer, useRef } from "react";
import {
  createChatControllerDebugId,
  createClientChatSessionId,
  logChatControllerDebug,
} from "./support/helpers";
import {
  chatSessionControllerReducer,
  createInitialChatSessionControllerBootstrap,
  selectChatConfig,
  selectChatSessionComposerAction,
  selectIsAssistantRunActive,
} from "./state/state";
import { isChatRunActive } from "./state/runState";
import { isChatSessionStale } from "./lifecycle/freshness";
import type {
  ChatSessionController,
  SendChatMessageParams,
  SendChatMessageResult,
  UseChatSessionControllerParams,
} from "./support/types";
import {
  loadChatSessionWarmStartSnapshot,
  storeChatSessionWarmStartSnapshot,
} from "./lifecycle/warmStart";
import { readCatalogChatHandoff } from "../handoff/catalogChatHandoff";
import { useChatHistory } from "../history/useChatHistory";
import { useChatAiUsage } from "./aiUsage/useAiUsage";
import { useChatSessionActions } from "./actions/useActions";
import { useChatSessionHydrationLifecycle } from "./lifecycle/useHydrationLifecycle";
import { useChatSessionSnapshotSync } from "./snapshotSync/useSnapshotSync";

export type {
  ChatSessionController,
  SendChatMessageParams,
  SendChatMessageResult,
  UseChatSessionControllerParams,
} from "./support/types";

export function useChatSessionController(
  params: UseChatSessionControllerParams,
): ChatSessionController {
  const {
    indexedDbOpenRecoveryState,
    workspaceId,
    accountId,
    isRemoteReady,
    uiLocale,
    onToolRunPostSyncRequested,
    uiMessages,
  } = params;
  const controllerIdRef = useRef<string>(createChatControllerDebugId());
  const controllerId = controllerIdRef.current;
  const initialWarmStartSnapshotRef = useRef<ReturnType<typeof loadChatSessionWarmStartSnapshot>>(null);
  const didLoadInitialWarmStartSnapshotRef = useRef<boolean>(false);
  if (didLoadInitialWarmStartSnapshotRef.current === false) {
    didLoadInitialWarmStartSnapshotRef.current = true;
    initialWarmStartSnapshotRef.current = indexedDbOpenRecoveryState.hasFailed()
      ? null
      : loadChatSessionWarmStartSnapshot(workspaceId);
  }
  const initialWarmStartSnapshot = initialWarmStartSnapshotRef.current;
  const catalogHandoff = readCatalogChatHandoff();
  const shouldRecoverCurrentCatalogChat = catalogHandoff?.topic != null || catalogHandoff?.transfer?.destinationWorkspaceId != null;
  const initialWarmStartSnapshotIsStale = initialWarmStartSnapshot !== null
    && !shouldRecoverCurrentCatalogChat && !initialWarmStartSnapshot.pendingToolRunPostSync
    && isChatSessionStale(initialWarmStartSnapshot.messages, Date.now());
  const initialFreshSessionIdRef = useRef<string>(createClientChatSessionId());
  const initialFreshSessionId = initialFreshSessionIdRef.current;
  const bootstrapRef = useRef(createInitialChatSessionControllerBootstrap(
    workspaceId,
    initialWarmStartSnapshot,
    initialWarmStartSnapshotIsStale,
    initialFreshSessionId,
  ));
  const bootstrap = bootstrapRef.current;
  const [state, dispatch] = useReducer(chatSessionControllerReducer, bootstrap.initialState);
  const history = useChatHistory(bootstrap.initialMessages);
  const { aiUsage, aiUsageLoadStatus, readHeldAiUsage, refreshAiUsageInBackground } = useChatAiUsage({
    indexedDbOpenRecoveryState,
    workspaceId,
    isRemoteReady,
  });
  const snapshotSync = useChatSessionSnapshotSync({
    indexedDbOpenRecoveryState,
    controllerId,
    workspaceId,
    accountId,
    isRemoteReady,
    shouldRecoverCurrentCatalogChat,
    uiMessages,
    state,
    dispatch,
    history,
    onToolRunPostSyncRequested,
    initialLastSnapshotUpdatedAt: initialWarmStartSnapshot !== null && initialWarmStartSnapshotIsStale === false
      ? initialWarmStartSnapshot.updatedAt
      : null,
    initialServerSessionId: initialWarmStartSnapshot !== null
      && initialWarmStartSnapshotIsStale === false
      && initialWarmStartSnapshot.isSessionOnServer
      ? initialWarmStartSnapshot.sessionId
      : null,
  });
  const actions = useChatSessionActions({
    indexedDbOpenRecoveryState,
    workspaceId,
    accountId,
    isRemoteReady,
    uiLocale,
    uiMessages,
    state,
    dispatch,
    history,
    snapshotSync,
    readHeldAiUsage,
    refreshAiUsageInBackground,
  });

  useChatSessionHydrationLifecycle({
    indexedDbOpenRecoveryState,
    workspaceId,
    isRemoteReady,
    shouldRecoverCurrentCatalogChat,
    uiLocale,
    uiMessages,
    state,
    dispatch,
    history,
    snapshotSync,
    initialWarmStartSnapshot,
    initialFreshSessionId,
    initialShouldBootstrapFreshLocalSession: bootstrap.shouldBootstrapFreshLocalSession,
    ensureRemoteSessionForHydration: actions.ensureRemoteSessionForHydration,
    ensureFreshSessionInBackground: actions.ensureFreshSessionInBackground,
    ensureFreshSessionWithRefreshError: actions.ensureFreshSessionWithRefreshError,
    getFreshSessionRequestSequence: actions.getFreshSessionRequestSequence,
  });

  useEffect(() => {
    logChatControllerDebug(controllerId, "controller_mounted", {
      workspaceId,
      isRemoteReady,
      currentSessionId: state.currentSessionId,
      isHistoryLoaded: state.isHistoryLoaded,
    });
  }, []);

  const previousRunStateRef = useRef(state.runState);
  useEffect(() => {
    const previousRunState = previousRunStateRef.current;
    previousRunStateRef.current = state.runState;
    if (isChatRunActive(previousRunState) && isChatRunActive(state.runState) === false) {
      refreshAiUsageInBackground();
    }
  }, [refreshAiUsageInBackground, state.runState]);

  const persistWarmStartSnapshot = useEffectEvent((): void => {
    if (
      indexedDbOpenRecoveryState.hasFailed()
      || workspaceId === null
      || state.currentSessionId === null
      || state.currentSessionId !== snapshotSync.runtimeRefs.currentSessionIdRef.current
      || state.isHistoryLoaded === false
    ) {
      return;
    }

    storeChatSessionWarmStartSnapshot(workspaceId, {
      sessionId: state.currentSessionId,
      conversationScopeId: state.currentSessionId,
      conversation: {
        updatedAt: snapshotSync.runtimeRefs.lastSnapshotUpdatedAtRef.current ?? Date.now(),
        mainContentInvalidationVersion: state.mainContentInvalidationVersion,
        messages: history.messages,
      },
      composerSuggestions: [],
      chatConfig: state.chatConfig,
      activeRun: null,
      // Custom instructions stay in memory only.
      customInstructions: null,
    }, state.pendingToolRunPostSync, snapshotSync.runtimeRefs.serverSessionIdRef.current === state.currentSessionId);
  });

  useEffect(() => {
    persistWarmStartSnapshot();
  }, [
    history.messages,
    persistWarmStartSnapshot,
    state.chatConfig,
    state.currentSessionId,
    state.isHistoryLoaded,
    state.mainContentInvalidationVersion,
    state.pendingToolRunPostSync,
    workspaceId,
  ]);

  const dismissErrorDialog = useCallback((): void => {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    dispatch({ type: "error_dismissed" });
  }, [indexedDbOpenRecoveryState]);

  const acceptServerSessionId = useCallback((sessionId: string | null): void => {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    dispatch({
      type: "accept_server_session_id",
      sessionId,
    });
  }, [indexedDbOpenRecoveryState]);

  const sendMessage = useCallback(async (
    sendParams: SendChatMessageParams,
  ): Promise<SendChatMessageResult> => {
    indexedDbOpenRecoveryState.throwIfFailed();
    const result = await actions.sendMessage(sendParams);
    indexedDbOpenRecoveryState.throwIfFailed();
    return result;
  }, [actions, indexedDbOpenRecoveryState]);

  const ensureRemoteSession = useCallback(async (): Promise<string> => {
    indexedDbOpenRecoveryState.throwIfFailed();
    const sessionId = await actions.ensureRemoteSession();
    indexedDbOpenRecoveryState.throwIfFailed();
    return sessionId;
  }, [actions, indexedDbOpenRecoveryState]);

  const { composerSendCountRef } = snapshotSync.runtimeRefs;
  const runComposerSend = useCallback(async (send: () => Promise<void>): Promise<void> => {
    composerSendCountRef.current += 1;
    try {
      await send();
    } finally {
      composerSendCountRef.current -= 1;
    }
  }, [composerSendCountRef]);

  const stopMessage = useCallback(async (): Promise<void> => {
    indexedDbOpenRecoveryState.throwIfFailed();
    await actions.stopMessage();
    indexedDbOpenRecoveryState.throwIfFailed();
  }, [actions, indexedDbOpenRecoveryState]);

  const clearConversation = useCallback(async (): Promise<string | null> => {
    indexedDbOpenRecoveryState.throwIfFailed();
    const sessionId = actions.clearConversation(null);
    indexedDbOpenRecoveryState.throwIfFailed();
    return sessionId;
  }, [actions, indexedDbOpenRecoveryState]);

  const canStartCatalogConversation = isRemoteReady && workspaceId !== null
    && state.isHistoryLoaded && snapshotSync.isWorkspaceRunReconciled
    && !state.isStopping && !selectIsAssistantRunActive(state) && !state.pendingToolRunPostSync;

  function startCatalogConversation(prepareDraft: (sessionId: string) => void): string | null {
    if (!canStartCatalogConversation || snapshotSync.isRunRecoveryPending()
      || snapshotSync.hasPendingToolRunPostSync() || composerSendCountRef.current > 0) return null;
    indexedDbOpenRecoveryState.throwIfFailed();
    return actions.clearConversation(prepareDraft);
  }

  return {
    messages: history.messages,
    runState: state.runState,
    isHistoryLoaded: state.isHistoryLoaded,
    isAssistantRunActive: selectIsAssistantRunActive(state),
    isLiveStreamConnected: snapshotSync.isLiveStreamConnected,
    isStopping: state.isStopping,
    currentSessionId: state.currentSessionId,
    mainContentInvalidationVersion: state.mainContentInvalidationVersion,
    chatConfig: selectChatConfig(state),
    composerSuggestions: state.composerSuggestions,
    composerAction: selectChatSessionComposerAction(state),
    composerNotice: state.composerNotice,
    errorDialogMessage: state.errorDialogMessage,
    aiUsage,
    aiUsageLoadStatus,
    refreshAiUsage: refreshAiUsageInBackground,
    dismissErrorDialog,
    acceptServerSessionId,
    ensureRemoteSession,
    runComposerSend,
    sendMessage,
    stopMessage,
    canStartCatalogConversation,
    startCatalogConversation,
    clearConversation,
  };
}
