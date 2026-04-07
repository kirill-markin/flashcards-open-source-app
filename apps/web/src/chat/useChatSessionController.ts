import { useCallback, useEffect, useEffectEvent, useReducer, useRef } from "react";
import {
  createChatControllerDebugId,
  createClientChatSessionId,
  logChatControllerDebug,
} from "./chatSessionControllerHelpers";
import {
  chatSessionControllerReducer,
  createInitialChatSessionControllerBootstrap,
  selectChatConfig,
  selectChatSessionComposerAction,
  selectIsAssistantRunActive,
} from "./chatSessionControllerState";
import type {
  ChatSessionController,
  SendChatMessageParams,
  SendChatMessageResult,
  UseChatSessionControllerParams,
} from "./chatSessionControllerTypes";
import { isChatSessionStale } from "./chatSessionFreshness";
import {
  loadChatSessionWarmStartSnapshot,
  storeChatSessionWarmStartSnapshot,
} from "./chatSessionWarmStart";
import { useChatHistory } from "./useChatHistory";
import { useChatSessionActions } from "./useChatSessionActions";
import { useChatSessionHydrationLifecycle } from "./useChatSessionHydrationLifecycle";
import { useChatSessionSnapshotSync } from "./useChatSessionSnapshotSync";

export type {
  ChatSessionController,
  SendChatMessageParams,
  SendChatMessageResult,
  UseChatSessionControllerParams,
} from "./chatSessionControllerTypes";

export function useChatSessionController(
  params: UseChatSessionControllerParams,
): ChatSessionController {
  const { workspaceId, isRemoteReady, onMainContentInvalidated } = params;
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
    state,
    dispatch,
    history,
    onMainContentInvalidated,
    initialLastSnapshotUpdatedAt: initialWarmStartSnapshot !== null && initialWarmStartSnapshotIsStale === false
      ? initialWarmStartSnapshot.updatedAt
      : null,
  });
  const actions = useChatSessionActions({
    workspaceId,
    isRemoteReady,
    state,
    dispatch,
    history,
    snapshotSync,
  });

  useChatSessionHydrationLifecycle({
    workspaceId,
    isRemoteReady,
    state,
    dispatch,
    history,
    snapshotSync,
    initialWarmStartSnapshot,
    initialFreshSessionId,
    initialShouldBootstrapFreshLocalSession: bootstrap.shouldBootstrapFreshLocalSession,
    ensureFreshSession: actions.ensureFreshSession,
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
    });
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
    sendMessage,
    stopMessage,
    clearConversation,
  };
}
