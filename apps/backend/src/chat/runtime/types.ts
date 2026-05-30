import type {
  ChatComposerSuggestionsLocale,
} from "../composerSuggestions";
import type {
  ServerChatMessage,
} from "../openai/replayItems";
import type {
  ContentPart,
} from "../types";

type ChatRunDiagnostics = Readonly<{
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  model: string;
  messageCount: number;
  hasAttachments: boolean;
  attachmentFileNames: ReadonlyArray<string>;
}>;

export type StartPersistedChatRunParams = Readonly<{
  lambdaRequestId: string | null;
  runId: string;
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  timezone: string;
  uiLocale: ChatComposerSuggestionsLocale | null;
  assistantItemId: string;
  localMessages: ReadonlyArray<ServerChatMessage>;
  turnInput: ReadonlyArray<ContentPart>;
  diagnostics: ChatRunDiagnostics;
  getRemainingTimeInMillis: () => number;
}>;

export type ChatWorkerAbortReason =
  | "user_cancelled"
  | "ownership_lost"
  | "initial_cancel_state"
  | "deadline_reached";

export type ChatWorkerExecutionPhase = "idle" | "model" | "tool";

export type ChatWorkerRunStatus =
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";

export type ChatWorkerSessionState = "idle" | "interrupted";

export type ChatWorkerRunResult = Readonly<{
  outcome: "completed" | "cancelled" | "ownership_lost" | "failed" | "interrupted";
  abortReason: ChatWorkerAbortReason | null;
  runStatus: ChatWorkerRunStatus | null;
  sessionState: ChatWorkerSessionState | null;
}>;

export class ChatRunOwnershipLostError extends Error {
  public constructor(runId: string) {
    super(`Chat run ownership lost: ${runId}`);
    this.name = "ChatRunOwnershipLostError";
  }
}
