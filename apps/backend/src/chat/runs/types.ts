import type { ServerChatMessage } from "../openai/replayItems";
import type { ChatComposerSuggestionsLocale } from "../composerSuggestions";
import type {
  ChatSessionRunState,
  ChatSessionSnapshot,
  PaginatedChatMessages,
} from "../store";
import type { ContentPart } from "../types";

export type ChatRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";

export type PreparedChatRun = Readonly<{
  sessionId: string;
  runId: string;
  clientRequestId: string;
  runState: ChatSessionRunState;
  deduplicated: boolean;
  shouldInvokeWorker: boolean;
}>;

export type ChatRunDiagnostics = Readonly<{
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  model: string;
  messageCount: number;
  hasAttachments: boolean;
  attachmentFileNames: ReadonlyArray<string>;
}>;

export type ClaimedChatRun = Readonly<{
  runId: string;
  sessionId: string;
  requestId: string;
  userId: string;
  workspaceId: string;
  timezone: string;
  uiLocale: ChatComposerSuggestionsLocale | null;
  assistantItemId: string;
  localMessages: ReadonlyArray<ServerChatMessage>;
  turnInput: ReadonlyArray<ContentPart>;
  diagnostics: ChatRunDiagnostics;
}>;

export type ChatRunHeartbeatState = Readonly<{
  cancellationRequested: boolean;
  ownershipLost: boolean;
}>;

export type ChatRunStopState = Readonly<{
  sessionId: string;
  stopped: boolean;
  stillRunning: boolean;
  runId: string | null;
}>;

export type ChatRunSnapshot = Readonly<{
  runId: string;
  sessionId: string;
  assistantItemId: string;
  status: ChatRunStatus;
  startedAt: number | null;
  finishedAt: number | null;
  lastErrorMessage: string | null;
}>;

export type RecoveredPaginatedSession = Readonly<{
  snapshot: ChatSessionSnapshot;
  page: PaginatedChatMessages;
}>;
