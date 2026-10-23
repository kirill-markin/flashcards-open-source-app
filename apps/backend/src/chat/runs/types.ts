import type { ServerChatMessage } from "../openai/replayItems";
import type { ChatComposerSuggestionsLocale } from "../composerSuggestions";
import type {
  ChatRuntimeModelId,
  ChatRuntimeReasoningEffort,
} from "../config";
import type { ChatCostPolicyMode } from "../costPolicy";
import type {
  ProductAnalyticsClientReportablePlatform,
  ProductAnalyticsDeviceType,
  ProductAnalyticsOsName,
} from "../../productAnalytics/catalog";
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

export type ChatRunClaimToken = string;

// The identity the turn was sent by, taken from the request context and carried alongside the
// workspace-scoped `userId`, because the analytics row a prepared run emits has to name a guest as
// precisely as an account. For a guest turn `subjectUserId` is the guest user id that guest's own
// client events already carry, and it is the key the upgrade's identity link resolves to the
// account. `guestSessionId` only records which guest session the turn came from; no attribution
// resolves through it.
export type ChatRunActor = Readonly<{
  subjectUserId: string;
  guestSessionId: string | null;
}>;

export type PreparedChatRun = Readonly<{
  browserGuestAiTrial?: boolean;
  sessionId: string;
  runId: string;
  clientRequestId: string;
  runState: ChatSessionRunState;
  deduplicated: boolean;
  shouldInvokeWorker: boolean;
  initiatingAuthIsSignedIn: boolean;
}>;

export type ChatRunDiagnostics = Readonly<{
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  model: string;
  aiCostMode: ChatCostPolicyMode;
  chatTurnsLast7d: number;
  goodReviewDaysLast7d: number;
  messageCount: number;
  hasAttachments: boolean;
  attachmentFileNames: ReadonlyArray<string>;
}>;

export type ClaimedChatRun = Readonly<{
  browserGuestAiTrial?: boolean;
  aiConsentId?: string | null;
  runId: string;
  claimToken: ChatRunClaimToken;
  sessionId: string;
  requestId: string;
  userId: string;
  workspaceId: string;
  timezone: string;
  uiLocale: ChatComposerSuggestionsLocale | null;
  modelId: ChatRuntimeModelId;
  reasoningEffort: ChatRuntimeReasoningEffort;
  assistantItemId: string;
  localMessages: ReadonlyArray<ServerChatMessage>;
  turnInput: ReadonlyArray<ContentPart>;
  initiatingAuthIsSignedIn: boolean;
  clientPlatform: ProductAnalyticsClientReportablePlatform | null;
  clientOsName: ProductAnalyticsOsName | null;
  clientDeviceType: ProductAnalyticsDeviceType | null;
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
  liveAttachClientId: string | null;
  liveAttachSeq: number;
}>;

export type RecoveredChatSession = Readonly<{
  snapshot: ChatSessionSnapshot;
  // Read in the snapshot's transaction under the session lock; null unless the snapshot is running.
  latestMessagesPage: PaginatedChatMessages | null;
}>;

export type RecoveredPaginatedSession = RecoveredChatSession & Readonly<{
  page: PaginatedChatMessages;
}>;
