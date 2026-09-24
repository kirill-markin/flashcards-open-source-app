/**
 * Worker entrypoint for backend-owned chat runs.
 * The HTTP route prepares and persists the run; the worker claims it and executes the model loop independently of the client connection.
 */
import { claimChatRun } from "../runs";
import { runPersistedChatSession, type ChatWorkerRunResult } from "../runtime";
import { logChatWorkerLifecycleEvent } from "./logging";
import { resolveAiUsageTierForFacts } from "../../aiUsage";
import { resolveAccountKindForSignedInAuth } from "../../billing/snapshot";
import type { BackendTraceCarrier } from "../../observability/sentry";

export type ChatWorkerEvent = Readonly<{
  runId: string;
  userId: string;
  workspaceId: string;
  initiatingAuthIsSignedIn?: boolean;
  routeRequestId?: string | null;
  chatRequestId?: string | null;
  sessionId?: string | null;
  traceContext?: BackendTraceCarrier | null;
}>;

export function isGeneratedImageEligibleForWorker(
  event: ChatWorkerEvent,
  initiatingAuthIsSignedIn: boolean,
): boolean {
  return event.initiatingAuthIsSignedIn === true && initiatingAuthIsSignedIn;
}

type ChatWorkerExecutionContext = Readonly<{
  lambdaRequestId: string | null;
  getRemainingTimeInMillis: () => number;
}>;

/**
 * Claims and executes one persisted chat run if it is still pending.
 */
export async function handleChatWorkerEvent(
  event: ChatWorkerEvent,
  executionContext: ChatWorkerExecutionContext,
): Promise<void> {
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
    generatedImageEligible: isGeneratedImageEligibleForWorker(
      event,
      claimedRun.initiatingAuthIsSignedIn,
    ),
    clientPlatform: claimedRun.clientPlatform,
    tierAtCall,
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
