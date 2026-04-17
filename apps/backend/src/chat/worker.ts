/**
 * Worker entrypoint for backend-owned chat runs.
 * The HTTP route prepares and persists the run; the worker claims it and executes the model loop independently of the client connection.
 */
import { claimChatRun } from "./runs";
import { runPersistedChatSession, type ChatWorkerRunResult } from "./runtime";
import { logChatWorkerLifecycleEvent } from "./workerLogging";

export type ChatWorkerEvent = Readonly<{
  runId: string;
  userId: string;
  workspaceId: string;
}>;

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
      chatRequestId: null,
      runId: event.runId,
      sessionId: null,
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
      providerRequestId: null,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
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
    providerRequestId: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
  }, false);

  const result: ChatWorkerRunResult = await runPersistedChatSession({
    lambdaRequestId: executionContext.lambdaRequestId,
    runId: claimedRun.runId,
    requestId: claimedRun.requestId,
    userId: claimedRun.userId,
    workspaceId: claimedRun.workspaceId,
    sessionId: claimedRun.sessionId,
    timezone: claimedRun.timezone,
    uiLocale: claimedRun.uiLocale,
    assistantItemId: claimedRun.assistantItemId,
    localMessages: claimedRun.localMessages,
    turnInput: claimedRun.turnInput,
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
    providerRequestId: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    outcome: result.outcome,
  }, false);
}
