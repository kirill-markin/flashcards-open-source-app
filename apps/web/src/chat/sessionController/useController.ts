import { useCallback, useEffect, useEffectEvent, useReducer, useRef } from "react";
import {
  createChatControllerDebugId,
  createClientChatSessionId,
  logChatControllerDebug,
} from "./helpers";
import {
  chatSessionControllerReducer,
  createInitialChatSessionControllerBootstrap,
  selectChatConfig,
  selectChatSessionComposerAction,
  selectIsAssistantRunActive,
} from "./state";
import { isChatSessionStale } from "./freshness";
import type {
  ChatSessionController,
  SendChatMessageParams,
  SendChatMessageResult,
  UseChatSessionControllerParams,
} from "./types";
import {
  loadChatSessionWarmStartSnapshot,
  storeChatSessionWarmStartSnapshot,
} from "./warmStart";
import { useChatHistory } from "../useChatHistory";
import { useChatSessionActions } from "./useActions";
import { useChatSessionHydrationLifecycle } from "./useHydrationLifecycle";
import { useChatSessionSnapshotSync } from "./useSnapshotSync";

export type {
  ChatSessionController,
  SendChatMessageParams,
  SendChatMessageResult,
  UseChatSessionControllerParams,
} from "./types";

export function useChatSessionController(
  params: UseChatSessionControllerParams,
): ChatSessionController {
  const {
    workspaceId,
    isRemoteReady,
    uiLocale,
    onToolRunPostSyncRequested,
    uiMessages,
  } = params;
  const controllerIdRef = useRef<string>(createChatControllerDebugId());
  const controllerId = controllerIdRef.current;
  const initialWarmStartSnapshotRef = useRef(loadChatSessionWarmStartSnapshot(workspaceId));
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
    ensureFreshSession: actions.ensureFreshSession,
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
    if (workspaceId === null || state.currentSessionId === null || state.isHistoryLoaded === false) {
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
    dispatch({ type: "error_dismissed" });
  }, []);

  const acceptServerSessionId = useCallback((sessionId: string | null): void => {
    dispatch({
      type: "accept_server_session_id",
      sessionId,
    });
  }, []);

  const sendMessage = useCallback(async (
    sendParams: SendChatMessageParams,
  ): Promise<SendChatMessageResult> => {
    return actions.sendMessage(sendParams);
  }, [actions]);

  const ensureRemoteSession = useCallback(async (): Promise<string> => {
    return actions.ensureRemoteSession();
  }, [actions]);

  const stopMessage = useCallback(async (): Promise<void> => {
    await actions.stopMessage();
  }, [actions]);

  const clearConversation = useCallback(async (): Promise<string | null> => {
    return actions.clearConversation();
  }, [actions]);

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
