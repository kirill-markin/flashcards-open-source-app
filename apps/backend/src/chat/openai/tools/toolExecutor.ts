import type { BrowserGuestTrialContext } from "../../../aiUsage/browserGuestTrial/policy";
import type OpenAI from "openai";
import {
  createBackendObservationScope,
} from "../../../observability/sentry";
import {
  executeChatToolCall,
  type ExecutedChatToolCall,
} from "./tools";
import type { ChatRunClaimToken } from "../../runs";
import type {
  ProductAnalyticsClientReportablePlatform,
  ProductAnalyticsDeviceType,
  ProductAnalyticsOsName,
} from "../../../productAnalytics/catalog";
import type { UserOpenAIApiKey } from "../../userOpenAIApiKey";

export async function runOneToolCall(
  params: Readonly<{
    item: OpenAI.Responses.ResponseFunctionToolCall;
    requestId: string;
    runId: string;
    sessionId: string;
    operationKey: string;
    browserGuestTrial?: BrowserGuestTrialContext;
    generatedImageEligible: boolean;
    claimToken: ChatRunClaimToken;
    userId: string;
    workspaceId: string;
    signal: AbortSignal | null;
    generatedImageOperationDeadlineMs: number;
    clientPlatform: ProductAnalyticsClientReportablePlatform | null;
    clientOsName: ProductAnalyticsOsName | null;
    clientDeviceType: ProductAnalyticsDeviceType | null;
    initiatingAuthIsSignedIn: boolean;
    userOpenAIApiKey: UserOpenAIApiKey | null;
    aiConsentId?: string | null;
  }>,
): Promise<ExecutedChatToolCall> {
  return executeChatToolCall(
    params.item.name,
    params.item.arguments,
    {
      runId: params.runId,
      sessionId: params.sessionId,
      toolCallId: params.item.call_id,
      operationKey: params.operationKey,
      browserGuestTrial: params.browserGuestTrial,
      generatedImageEligible: params.generatedImageEligible,
      userId: params.userId,
      workspaceId: params.workspaceId,
      aiConsentId: params.aiConsentId ?? null,
      claimToken: params.claimToken,
      signal: params.signal,
      generatedImageOperationDeadlineMs: params.generatedImageOperationDeadlineMs,
      clientPlatform: params.clientPlatform,
      clientOsName: params.clientOsName,
      clientDeviceType: params.clientDeviceType,
      initiatingAuthIsSignedIn: params.initiatingAuthIsSignedIn,
      userOpenAIApiKey: params.userOpenAIApiKey,
      generatedImageObservationContext: {
        scope: createBackendObservationScope(
          "chat-worker", null, null, null, params.userId, params.workspaceId,
          params.requestId, params.runId, params.sessionId, null, null,
        ),
      },
    },
  );
}
