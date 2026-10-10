/**
 * Public facade for backend-owned chat session/message persistence APIs.
 * Internal implementation is split across focused modules under `./store/`.
 */
export type {
  ArchivedChatSession,
  ChatItemState,
  ChatSessionHistoryCursor,
  ChatSessionHistoryPage,
  ChatSessionHistorySummary,
  ChatSessionRunState,
  ChatSessionSnapshot,
  PaginatedChatMessages,
  PersistedChatMessageItem,
} from "./store/types";

export {
  ChatSessionArchiveActiveRunError,
  ChatSessionConflictError,
  ChatSessionNotFoundError,
  FAILED_TOOL_CALL_OUTPUT,
  INTERRUPTED_TOOL_CALL_OUTPUT,
  STOPPED_BY_USER_TOOL_OUTPUT,
} from "./store/types";

export { buildLocalChatMessages } from "./store/mappers";

export {
  insertChatItemWithExecutor,
  updateChatItemWithExecutor,
  updateAssistantMessageItem,
  updateAssistantMessageItemAndInvalidateMainContent,
  buildUserStoppedAssistantContent,
  buildUserStoppedChatRunUpdatePlan,
} from "./store/messageService";

export {
  activateChatComposerSuggestionGenerationWithExecutor,
  clearActiveChatComposerSuggestionGenerationWithExecutor,
  clearActiveChatComposerSuggestionGeneration,
  createFollowUpChatComposerSuggestionGenerationWithExecutor,
  createInitialChatComposerSuggestionGenerationWithExecutor,
} from "./store/composerSuggestionService";

export {
  createFreshChatSession,
  createFreshChatSessionWithExecutor,
  getChatSessionId,
  getChatSessionIdWithExecutor,
  getLatestChatSessionId,
  getLatestChatSessionIdWithExecutor,
  resolveLatestOrCreateChatSessionWithExecutor,
  resolveRequestedChatSessionWithExecutor,
  resolveRequestedOrCreateChatSessionWithExecutor,
  rolloverToFreshChatSession,
  selectRequestedChatSessionWithExecutor,
  touchChatSessionHeartbeat,
  touchChatSessionHeartbeatWithExecutor,
  updateChatSessionRunStateForActiveRunWithExecutor,
  updateChatSessionRunStateWithExecutor,
} from "./store/sessionService";

export {
  archiveLockedChatSessionWithExecutor,
  listChatSessionHistory,
  lockHistoryChatSessionWithExecutor,
  renameChatSession,
} from "./store/historyService";

export {
  getChatSessionSnapshot,
  getChatSessionSnapshotWithExecutor,
  listChatMessages,
  listChatMessagesAfterCursor,
  listChatMessagesAfterCursorWithExecutor,
  listChatMessagesBefore,
  listChatMessagesBeforeWithExecutor,
  listChatMessagesLatest,
  listChatMessagesLatestWithExecutor,
  listChatMessagesWithExecutor,
} from "./store/readService";

export {
  cancelActiveChatRunByUser,
  cancelActiveChatRunByUserWithExecutor,
  completeChatRun,
  persistAssistantCancelled,
  persistAssistantTerminalError,
} from "./store/terminalRunService";
