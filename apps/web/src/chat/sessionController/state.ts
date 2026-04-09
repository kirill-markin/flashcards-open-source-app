import type { ChatComposerSuggestion, ChatConfig } from "../../types";
import type { StoredMessage } from "../useChatHistory";
import { defaultChatConfig, loadStoredChatConfig } from "./config";
import { getChatComposerAction, isChatRunActive, type ChatComposerAction, type ChatRunState } from "./runState";
import type { WarmStartChatSessionSnapshot } from "./warmStart";

export type ChatSessionControllerState = Readonly<{
  currentSessionId: string | null;
  isHistoryLoaded: boolean;
  runState: ChatRunState;
  isStopping: boolean;
  pendingToolRunPostSync: boolean;
  mainContentInvalidationVersion: number;
  chatConfig: ChatConfig;
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>;
  composerNotice: string | null;
  errorDialogMessage: string | null;
}>;

export type ChatSessionControllerAction =
  | Readonly<{ type: "accept_server_session_id"; sessionId: string | null }>
  | Readonly<{ type: "error_dismissed" }>
  | Readonly<{ type: "error_shown"; message: string }>
  | Readonly<{ type: "fresh_session_ready"; sessionId: string; composerSuggestions: ReadonlyArray<ChatComposerSuggestion>; chatConfig: ChatConfig }>
  | Readonly<{ type: "fresh_session_requested"; sessionId: string; chatConfig: ChatConfig }>
  | Readonly<{ type: "live_attach_connected" }>
  | Readonly<{ type: "run_completed" }>
  | Readonly<{ type: "run_interrupted"; message: string }>
  | Readonly<{ type: "run_started"; sessionId: string; runState: ChatRunState; composerSuggestions: ReadonlyArray<ChatComposerSuggestion>; chatConfig: ChatConfig }>
  | Readonly<{ type: "set_history_loaded"; isHistoryLoaded: boolean }>
  | Readonly<{ type: "snapshot_applied"; sessionId: string; runState: ChatRunState; mainContentInvalidationVersion: number; composerSuggestions: ReadonlyArray<ChatComposerSuggestion>; chatConfig: ChatConfig }>
  | Readonly<{ type: "stop_finished"; runState: ChatRunState }>
  | Readonly<{ type: "stop_requested" }>
  | Readonly<{ type: "tool_run_post_sync_consumed" }>
  | Readonly<{ type: "tool_run_post_sync_marked" }>
  | Readonly<{ type: "warm_start_applied"; sessionId: string; mainContentInvalidationVersion: number; chatConfig: ChatConfig; pendingToolRunPostSync: boolean }>
  | Readonly<{ type: "warm_start_stale"; sessionId: string; chatConfig: ChatConfig }>
  | Readonly<{ type: "workspace_cleared" }>
  | Readonly<{ type: "workspace_hydration_started" }>;

export type ChatSessionControllerBootstrap = Readonly<{
  initialState: ChatSessionControllerState;
  initialMessages: ReadonlyArray<StoredMessage>;
  shouldBootstrapFreshLocalSession: boolean;
}>;

function clearUiState(
  state: ChatSessionControllerState,
): Pick<ChatSessionControllerState, "composerNotice" | "errorDialogMessage"> {
  return {
    composerNotice: null,
    errorDialogMessage: null,
  };
}

function createEmptyConversationState(
  state: ChatSessionControllerState,
  currentSessionId: string | null,
  isHistoryLoaded: boolean,
): ChatSessionControllerState {
  return {
    ...state,
    currentSessionId,
    isHistoryLoaded,
    runState: "idle",
    isStopping: false,
    pendingToolRunPostSync: false,
    mainContentInvalidationVersion: 0,
    composerSuggestions: [],
    ...clearUiState(state),
  };
}

export function createInitialChatSessionControllerBootstrap(
  workspaceId: string | null,
  initialWarmStartSnapshot: WarmStartChatSessionSnapshot | null,
  initialWarmStartSnapshotIsStale: boolean,
  initialFreshSessionId: string,
): ChatSessionControllerBootstrap {
  const storedChatConfig = loadStoredChatConfig();
  const initialState: ChatSessionControllerState = {
    currentSessionId: initialWarmStartSnapshot === null
      ? null
      : initialWarmStartSnapshotIsStale
        ? initialFreshSessionId
        : initialWarmStartSnapshot.sessionId,
    isHistoryLoaded: workspaceId === null || initialWarmStartSnapshot !== null,
    runState: "idle",
    isStopping: false,
    pendingToolRunPostSync: initialWarmStartSnapshot !== null && initialWarmStartSnapshotIsStale === false
      ? initialWarmStartSnapshot.pendingToolRunPostSync
      : false,
    mainContentInvalidationVersion: initialWarmStartSnapshot !== null && initialWarmStartSnapshotIsStale === false
      ? initialWarmStartSnapshot.mainContentInvalidationVersion
      : 0,
    chatConfig: initialWarmStartSnapshot !== null && initialWarmStartSnapshotIsStale === false
      ? initialWarmStartSnapshot.chatConfig
      : storedChatConfig,
    composerSuggestions: [],
    composerNotice: null,
    errorDialogMessage: null,
  };

  return {
    initialState,
    initialMessages: initialWarmStartSnapshot !== null && initialWarmStartSnapshotIsStale === false
      ? initialWarmStartSnapshot.messages
      : [],
    shouldBootstrapFreshLocalSession: initialWarmStartSnapshotIsStale,
  };
}

export function chatSessionControllerReducer(
  state: ChatSessionControllerState,
  action: ChatSessionControllerAction,
): ChatSessionControllerState {
  switch (action.type) {
    case "accept_server_session_id":
      return {
        ...state,
        currentSessionId: action.sessionId,
      };
    case "error_dismissed":
      return {
        ...state,
        errorDialogMessage: null,
      };
    case "error_shown":
      return {
        ...state,
        composerNotice: null,
        errorDialogMessage: action.message,
      };
    case "fresh_session_ready":
      return {
        ...state,
        currentSessionId: action.sessionId,
        composerSuggestions: action.composerSuggestions,
        chatConfig: action.chatConfig,
      };
    case "fresh_session_requested":
      return {
        ...state,
        currentSessionId: action.sessionId,
        isHistoryLoaded: true,
        runState: "idle",
        isStopping: false,
        pendingToolRunPostSync: false,
        mainContentInvalidationVersion: 0,
        chatConfig: action.chatConfig,
        composerSuggestions: [],
        ...clearUiState(state),
      };
    case "live_attach_connected":
      return state.errorDialogMessage === null
        ? state
        : {
          ...state,
          errorDialogMessage: null,
        };
    case "run_completed":
      return {
        ...state,
        runState: "idle",
        isStopping: false,
      };
    case "run_interrupted":
      return {
        ...state,
        runState: "interrupted",
        isStopping: false,
        composerNotice: null,
        errorDialogMessage: action.message,
      };
    case "run_started":
      return {
        ...state,
        currentSessionId: action.sessionId,
        runState: action.runState,
        isStopping: false,
        chatConfig: action.chatConfig,
        composerSuggestions: action.composerSuggestions,
        ...clearUiState(state),
      };
    case "set_history_loaded":
      return {
        ...state,
        isHistoryLoaded: action.isHistoryLoaded,
      };
    case "snapshot_applied":
      return {
        ...state,
        currentSessionId: action.sessionId,
        runState: action.runState,
        mainContentInvalidationVersion: action.mainContentInvalidationVersion,
        chatConfig: action.chatConfig,
        composerSuggestions: action.composerSuggestions,
        composerNotice: null,
      };
    case "stop_finished":
      return {
        ...state,
        runState: action.runState,
        isStopping: false,
      };
    case "stop_requested":
      return {
        ...state,
        isStopping: true,
      };
    case "tool_run_post_sync_consumed":
      return state.pendingToolRunPostSync === false
        ? state
        : {
          ...state,
          pendingToolRunPostSync: false,
        };
    case "tool_run_post_sync_marked":
      return state.pendingToolRunPostSync
        ? state
        : {
          ...state,
          pendingToolRunPostSync: true,
        };
    case "warm_start_applied":
      return {
        ...state,
        currentSessionId: action.sessionId,
        isHistoryLoaded: true,
        runState: "idle",
        isStopping: false,
        pendingToolRunPostSync: action.pendingToolRunPostSync,
        mainContentInvalidationVersion: action.mainContentInvalidationVersion,
        chatConfig: action.chatConfig,
        composerSuggestions: [],
        ...clearUiState(state),
      };
    case "warm_start_stale":
      return {
        ...state,
        currentSessionId: action.sessionId,
        isHistoryLoaded: true,
        runState: "idle",
        isStopping: false,
        pendingToolRunPostSync: false,
        mainContentInvalidationVersion: 0,
        chatConfig: action.chatConfig,
        composerSuggestions: [],
        ...clearUiState(state),
      };
    case "workspace_cleared":
      return createEmptyConversationState(state, null, true);
    case "workspace_hydration_started":
      return createEmptyConversationState(state, null, false);
    default:
      return state;
  }
}

export function selectChatSessionComposerAction(
  state: ChatSessionControllerState,
): ChatComposerAction {
  return getChatComposerAction(state.runState);
}

export function selectIsAssistantRunActive(
  state: ChatSessionControllerState,
): boolean {
  return isChatRunActive(state.runState);
}

export function selectChatConfig(
  state: ChatSessionControllerState,
): ChatConfig {
  return state.chatConfig ?? defaultChatConfig;
}
