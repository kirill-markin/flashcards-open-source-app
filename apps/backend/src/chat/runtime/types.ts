import type {
  ChatComposerSuggestionsLocale,
} from "../composerSuggestions";
import type {
  ChatRuntimeModelId,
  ChatRuntimeReasoningEffort,
} from "../config";
import type { ChatCostPolicyMode } from "../costPolicy";
import type { ProductAnalyticsClientReportablePlatform } from "../../productAnalytics/catalog";
import type {
  ServerChatMessage,
} from "../openai/replayItems";
import type {
  ContentPart,
} from "../types";
import type { ChatRunClaimToken } from "../runs";
import type { EntitlementTier } from "../../billing/tiers";

type ChatRunDiagnostics = Readonly<{
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

export type StartPersistedChatRunParams = Readonly<{
  lambdaRequestId: string | null;
  runId: string;
  claimToken: ChatRunClaimToken;
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  timezone: string;
  uiLocale: ChatComposerSuggestionsLocale | null;
  modelId: ChatRuntimeModelId;
  reasoningEffort: ChatRuntimeReasoningEffort;
  assistantItemId: string;
  localMessages: ReadonlyArray<ServerChatMessage>;
  turnInput: ReadonlyArray<ContentPart>;
  generatedImageEligible: boolean;
  clientPlatform: ProductAnalyticsClientReportablePlatform | null;
  /**
   * The tier every usage fact this run appends is attributed to, resolved once when the run was claimed.
   * It is carried rather than re-resolved because one turn makes up to thirty model calls plus a
   * composer-suggestion call, and a tier that changes mid-run is not worth a billing read per call.
   */
  tierAtCall: EntitlementTier;
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
