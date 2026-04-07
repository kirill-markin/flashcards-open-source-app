import type { ChatComposerSuggestion } from "../composerSuggestions";
import type { StoredMessage } from "../history";
import type { StoredOpenAIReplayItem } from "../openai/replayItems";
import type { ContentPart } from "../types";

export type ChatSessionRunState = "idle" | "running" | "interrupted";
export type ChatItemState = "in_progress" | "completed" | "error" | "cancelled";

const INCOMPLETE_TOOL_CALL_PROVIDER_STATUS = "incomplete";
export { INCOMPLETE_TOOL_CALL_PROVIDER_STATUS };

export const STOPPED_BY_USER_TOOL_OUTPUT = "Stopped by user";
export const INTERRUPTED_TOOL_CALL_OUTPUT = "Interrupted before output was captured.";
export const FAILED_TOOL_CALL_OUTPUT = "Tool failed before returning output.";

export type InsertChatItemParams = Readonly<{
  sessionId: string;
  role: "user" | "assistant";
  state: ChatItemState;
  content: ReadonlyArray<ContentPart>;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
}>;

export type UpdateChatMessageItemParams = Readonly<{
  itemId: string;
  content: ReadonlyArray<ContentPart>;
  state: ChatItemState;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
}>;

export type UpdateChatMessageItemAndInvalidateMainContentParams = Readonly<{
  itemId: string;
  content: ReadonlyArray<ContentPart>;
  state: ChatItemState;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
}>;

export type PersistAssistantTerminalErrorParams = Readonly<{
  runId: string;
  sessionId: string;
  assistantItemId: string;
  assistantContent: ReadonlyArray<ContentPart>;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
  errorMessage: string;
  sessionState: ChatSessionRunState;
}>;

export type PersistAssistantCancelledParams = Readonly<{
  runId: string;
  sessionId: string;
  assistantItemId: string;
  assistantContent: ReadonlyArray<ContentPart>;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
}>;

export type CompleteChatRunParams = Readonly<{
  runId: string;
  sessionId: string;
  assistantItemId: string;
  assistantContent: ReadonlyArray<ContentPart>;
  assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
  composerSuggestions?: ReadonlyArray<ChatComposerSuggestion>;
}>;

export type PersistedChatMessageItem = Readonly<{
  itemId: string;
  sessionId: string;
  itemOrder: number;
  role: "user" | "assistant";
  content: ReadonlyArray<ContentPart>;
  openaiItems?: ReadonlyArray<StoredOpenAIReplayItem>;
  state: ChatItemState;
  isError: boolean;
  isStopped: boolean;
  timestamp: number;
  updatedAt: number;
}>;

export type ChatSessionSnapshot = Readonly<{
  sessionId: string;
  runState: ChatSessionRunState;
  activeRunId: string | null;
  updatedAt: number;
  activeRunHeartbeatAt: number | null;
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>;
  mainContentInvalidationVersion: number;
  messages: ReadonlyArray<StoredMessage>;
}>;

export type PaginatedChatMessages = Readonly<{
  messages: ReadonlyArray<PersistedChatMessageItem>;
  hasOlder: boolean;
  oldestCursor: string | null;
  newestCursor: string | null;
}>;

export type UserStoppedChatRunUpdatePlan = Readonly<{
  assistantItem: PersistedChatMessageItem | null;
  assistantContent: ReadonlyArray<ContentPart> | null;
  assistantOpenAIItems: ReadonlyArray<StoredOpenAIReplayItem> | null;
  sessionState: ChatSessionRunState;
}>;

export class ChatSessionNotFoundError extends Error {
  public constructor(sessionId: string) {
    super(`Chat session not found: ${sessionId}`);
    this.name = "ChatSessionNotFoundError";
  }
}

export class ChatSessionConflictError extends Error {
  public constructor(sessionId: string) {
    super(`Chat session already has an active run: ${sessionId}`);
    this.name = "ChatSessionConflictError";
  }
}
