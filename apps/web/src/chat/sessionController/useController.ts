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
import { useChatHistory } from "../history/useChatHistory";
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
  const initialWarmStartSnapshotIsStale = initialWarmStartSnapshot === null
    ? false
    : isChatSessionStale(initialWarmStartSnapshot.messages, Date.now());
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
  const snapshotSync = useChatSessionSnapshotSync({
    indexedDbOpenRecoveryState,
    controllerId,
    workspaceId,
    isRemoteReady,
    uiMessages,
    state,
    dispatch,
    history,
    onToolRunPostSyncRequested,
    initialLastSnapshotUpdatedAt: initialWarmStartSnapshot !== null && initialWarmStartSnapshotIsStale === false
      ? initialWarmStartSnapshot.updatedAt
      : null,
  });
  const actions = useChatSessionActions({
    indexedDbOpenRecoveryState,
    workspaceId,
    isRemoteReady,
    uiLocale,
    uiMessages,
    state,
    dispatch,
    history,
    snapshotSync,
  });

  useChatSessionHydrationLifecycle({
    indexedDbOpenRecoveryState,
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

  const persistWarmStartSnapshot = useEffectEvent((): void => {
    if (
      indexedDbOpenRecoveryState.hasFailed()
      || workspaceId === null
      || state.currentSessionId === null
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
    }, state.pendingToolRunPostSync);
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

  const stopMessage = useCallback(async (): Promise<void> => {
    indexedDbOpenRecoveryState.throwIfFailed();
    await actions.stopMessage();
    indexedDbOpenRecoveryState.throwIfFailed();
  }, [actions, indexedDbOpenRecoveryState]);

  const clearConversation = useCallback(async (): Promise<string | null> => {
    indexedDbOpenRecoveryState.throwIfFailed();
    const sessionId = await actions.clearConversation();
    indexedDbOpenRecoveryState.throwIfFailed();
    return sessionId;
  }, [actions, indexedDbOpenRecoveryState]);

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
    dismissErrorDialog,
    acceptServerSessionId,
    ensureRemoteSession,
    sendMessage,
    stopMessage,
    clearConversation,
  };
}
