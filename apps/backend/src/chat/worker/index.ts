import type { BrowserGuestTrialContext } from "../../aiUsage/browserGuestTrial/policy";
import { claimChatRun, failQueuedChatRun, recordAiRunFailedAnalytics } from "../runs";
import { runPersistedChatSession, type ChatWorkerRunResult } from "../runtime";
import {
  classifyChatRunFailureCategory,
  createPublicTerminalErrorMessage,
} from "../runtime/providerErrors";
import { logChatWorkerLifecycleEvent } from "./logging";
import { assertTrustedChatWorkerInvocation } from "./invoke";
import { resolveTrustedChatWorkerOwner } from "../runs/ownerScope";
import { resolveAiUsageTierForFacts } from "../../aiUsage";
import { resolveAccountKindForSignedInAuth } from "../../billing/snapshot";
import { convertLegacyChatSessionAttachments } from "../../chatFiles";
import { runDatabaseOperationsWithPerCallCap } from "../../database";
import { HttpError } from "../../shared/errors";
import {
  createBackendObservationScope,
  type BackendTraceCarrier,
} from "../../observability/sentry";
import {
  wrapWorkerPayloadUserOpenAIApiKey,
  type UserOpenAIApiKey,
} from "../userOpenAIApiKey";

export type ChatWorkerEvent = Readonly<{
  runId: string;
  userId: string;
  workspaceId: string;
  initiatingAuthIsSignedIn?: boolean;
  browserGuestSessionId?: string | null;
  userOpenAIApiKey?: string | null;
  routeRequestId?: string | null;
  chatRequestId?: string | null;
  sessionId?: string | null;
  traceContext?: BackendTraceCarrier | null;
}>;

export function isGeneratedImageEligibleForWorker(
  event: ChatWorkerEvent,
  initiatingAuthIsSignedIn: boolean,
  userOpenAIApiKey: UserOpenAIApiKey | null,
): boolean {
  return userOpenAIApiKey !== null || (event.initiatingAuthIsSignedIn === true && initiatingAuthIsSignedIn);
}

// Every database call of one worker invocation, the claim and the run's heartbeats included, fails
// after this long instead of waiting on a dead connection until the Lambda is killed.
const CHAT_WORKER_DATABASE_CALL_CAP_MS = 30_000;

type ChatWorkerExecutionContext = Readonly<{
  lambdaRequestId: string | null;
  getRemainingTimeInMillis: () => number;
}>;

export async function handleChatWorkerEvent(
  event: ChatWorkerEvent,
  executionContext: ChatWorkerExecutionContext,
): Promise<void> {
  assertTrustedChatWorkerInvocation(event);
  return runDatabaseOperationsWithPerCallCap(
    CHAT_WORKER_DATABASE_CALL_CAP_MS,
    async () => claimAndRunChatWorkerEvent(event, executionContext),
  );
}

/**
 * Runs before the claim, because the claim builds the replayed history from the stored rows. Conversion
 * failures terminalize the queued run; an account-scope refusal leaves it queued for a fresh delivery.
 * Both are rethrown for the handler to report.
 */
export async function convertLegacyAttachmentsBeforeClaim(
  event: ChatWorkerEvent,
  userId: string,
  executionContext: ChatWorkerExecutionContext,
): Promise<void> {
  try {
    await convertLegacyChatSessionAttachments(
      userId,
      event.workspaceId,
      event.runId,
      createBackendObservationScope(
        "chat-worker",
        executionContext.lambdaRequestId,
        null,
        null,
        userId,
        event.workspaceId,
        event.chatRequestId ?? null,
        event.runId,
        event.sessionId ?? null,
        null,
        null,
      ),
    );
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 409 && error.code === "ACCOUNT_SCOPE_CHANGED") {
      throw error;
    }
    const failed = await failQueuedChatRun(
      userId,
      event.workspaceId,
      event.runId,
      createPublicTerminalErrorMessage(error),
    );
    if (failed) {
      await recordAiRunFailedAnalytics(
        userId,
        event.workspaceId,
        event.runId,
        classifyChatRunFailureCategory(error),
      );
    }
    throw error;
  }
}

async function claimAndRunChatWorkerEvent(
  event: ChatWorkerEvent,
  executionContext: ChatWorkerExecutionContext,
): Promise<void> {
  const userOpenAIApiKey = wrapWorkerPayloadUserOpenAIApiKey(event.userOpenAIApiKey);
  const userId = await resolveTrustedChatWorkerOwner(
    event.userId, event.workspaceId, event.runId, event.sessionId ?? null, event.chatRequestId ?? null,
  );
  if (userId !== null) await convertLegacyAttachmentsBeforeClaim(event, userId, executionContext);
  const claimedRun = await claimChatRun(event.userId, event.workspaceId, event.runId);
  if (claimedRun === null) {
    logChatWorkerLifecycleEvent("chat_worker_skip", {
      lambdaRequestId: executionContext.lambdaRequestId,
      chatRequestId: event.chatRequestId ?? null,
      runId: event.runId,
      sessionId: event.sessionId ?? null,
      userId: event.userId,
      workspaceId: event.workspaceId,
    }, {
      abortReason: null,
      signalAborted: false,
      cancellationRequested: false,
      ownershipLost: false,
      runStatus: null,
      sessionState: null,
      providerErrorClass: null,
      providerErrorMessage: null,
      providerErrorType: null,
      providerErrorParam: null,
      providerRequestId: null,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      outcome: null,
    }, false);
    return;
  }

  const logContext = {
    lambdaRequestId: executionContext.lambdaRequestId,
    chatRequestId: claimedRun.requestId,
    runId: claimedRun.runId,
    sessionId: claimedRun.sessionId,
    userId: claimedRun.userId,
    workspaceId: claimedRun.workspaceId,
  } as const;

  logChatWorkerLifecycleEvent("chat_worker_claimed", logContext, {
    abortReason: null,
    signalAborted: false,
    cancellationRequested: false,
    ownershipLost: false,
    runStatus: null,
    sessionState: null,
    providerErrorClass: null,
    providerErrorMessage: null,
    providerErrorType: null,
    providerErrorParam: null,
    providerRequestId: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    outcome: null,
  }, false);

  // Resolved once per claimed run, and only resolved: the allowance was already enforced when the turn
  // was accepted, and refusing here would abandon a run the caller is waiting on. What the worker needs
  // from it is the tier every usage fact this run appends is attributed to, which is why this call
  // cannot reject - the run is already claimed, so a rejection here would strand it until stale-run
  // recovery over a label.
  const tierAtCall = await resolveAiUsageTierForFacts(
    claimedRun.userId,
    resolveAccountKindForSignedInAuth(claimedRun.initiatingAuthIsSignedIn),
    new Date(),
  );

  const result: ChatWorkerRunResult = await runPersistedChatSession({
    aiConsentId: claimedRun.aiConsentId ?? null,
    lambdaRequestId: executionContext.lambdaRequestId,
    runId: claimedRun.runId,
    claimToken: claimedRun.claimToken,
    requestId: claimedRun.requestId,
    userId: claimedRun.userId,
    workspaceId: claimedRun.workspaceId,
    sessionId: claimedRun.sessionId,
    timezone: claimedRun.timezone,
    uiLocale: claimedRun.uiLocale,
    modelId: claimedRun.modelId,
    reasoningEffort: claimedRun.reasoningEffort,
    assistantItemId: claimedRun.assistantItemId,
    localMessages: claimedRun.localMessages,
    turnInput: claimedRun.turnInput,
    browserGuestTrial: claimedRun.browserGuestAiTrial === true && userOpenAIApiKey === null ? {
      userId: claimedRun.userId, transport: "guest", guestPlatform: "web",
      guestSessionPurpose: "browser_product", guestCredentialSource: "cookie",
      guestSessionId: event.browserGuestSessionId ?? null,
    } satisfies BrowserGuestTrialContext : undefined,
    generatedImageEligible: claimedRun.browserGuestAiTrial === true || isGeneratedImageEligibleForWorker(
      event,
      claimedRun.initiatingAuthIsSignedIn,
      userOpenAIApiKey,
    ),
    userOpenAIApiKey,
    clientPlatform: claimedRun.clientPlatform,
    clientOsName: claimedRun.clientOsName,
    clientDeviceType: claimedRun.clientDeviceType,
    tierAtCall,
    initiatingAuthIsSignedIn: claimedRun.initiatingAuthIsSignedIn,
    diagnostics: claimedRun.diagnostics,
    getRemainingTimeInMillis: executionContext.getRemainingTimeInMillis,
  });

  logChatWorkerLifecycleEvent("chat_worker_finish", logContext, {
    abortReason: result.abortReason,
    signalAborted: result.abortReason !== null,
    cancellationRequested: result.abortReason === "user_cancelled" || result.abortReason === "initial_cancel_state",
    ownershipLost: result.abortReason === "ownership_lost",
    runStatus: result.runStatus,
    sessionState: result.sessionState,
    providerErrorClass: null,
    providerErrorMessage: null,
    providerErrorType: null,
    providerErrorParam: null,
    providerRequestId: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    outcome: result.outcome,
  }, false);
}
