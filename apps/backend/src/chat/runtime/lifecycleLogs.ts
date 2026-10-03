import {
  normalizeCaughtError,
} from "../../observability/sentry";
import {
  captureChatWorkerTerminalStateException,
  logChatWorkerLifecycleEvent,
  logChatWorkerTerminalStateEvent,
  type ChatWorkerLogContext,
} from "../worker/logging";
import {
  createSafeProviderErrorDetails,
  isChatAttachmentRejectedError,
  isContextLengthExceededError,
  isHandledProviderFailure,
  isKeyOwnedProviderFailure,
} from "./providerErrors";
import type {
  ChatWorkerAbortReason,
  ChatWorkerRunStatus,
  ChatWorkerSessionState,
  StartPersistedChatRunParams,
} from "./types";

function toIsoStringOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function createWorkerLogContext(params: StartPersistedChatRunParams): ChatWorkerLogContext {
  return {
    lambdaRequestId: params.lambdaRequestId,
    chatRequestId: params.requestId,
    runId: params.runId,
    sessionId: params.sessionId,
    userId: params.userId,
    workspaceId: params.workspaceId,
  };
}

export function logAbortRequested(
  context: ChatWorkerLogContext,
  reason: ChatWorkerAbortReason,
  heartbeatAt: Date | null,
  cancellationRequested: boolean,
  ownershipLost: boolean,
  signalAborted: boolean,
): void {
  logChatWorkerLifecycleEvent("chat_worker_abort_requested", context, {
    abortReason: reason,
    signalAborted,
    cancellationRequested,
    ownershipLost,
    runStatus: null,
    sessionState: null,
    ...createSafeProviderErrorDetails(null),
    heartbeatAt: toIsoStringOrNull(heartbeatAt),
    startedAt: null,
    finishedAt: null,
    outcome: null,
  }, false);
}

export function logProviderCallStarted(
  context: ChatWorkerLogContext,
  startedAt: Date,
  signalAborted: boolean,
): void {
  logChatWorkerLifecycleEvent("chat_worker_provider_call_started", context, {
    abortReason: null,
    signalAborted,
    cancellationRequested: false,
    ownershipLost: false,
    runStatus: null,
    sessionState: null,
    ...createSafeProviderErrorDetails(null),
    heartbeatAt: null,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    outcome: null,
  }, false);
}

export function logProviderCallAborted(
  context: ChatWorkerLogContext,
  error: unknown,
  abortReason: ChatWorkerAbortReason,
  cancellationRequested: boolean,
  ownershipLost: boolean,
  signalAborted: boolean,
): void {
  logChatWorkerLifecycleEvent("chat_worker_provider_call_aborted", context, {
    abortReason,
    signalAborted,
    cancellationRequested,
    ownershipLost,
    runStatus: null,
    sessionState: null,
    ...createSafeProviderErrorDetails(error),
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    outcome: null,
  }, false);
}

export function logTerminalStatePersisted(
  context: ChatWorkerLogContext,
  error: unknown | null,
  abortReason: ChatWorkerAbortReason | null,
  signalAborted: boolean,
  runStatus: ChatWorkerRunStatus,
  sessionState: ChatWorkerSessionState,
  cancellationRequested: boolean,
  ownershipLost: boolean,
  startedAt: Date,
  finishedAt: Date,
  userSuppliedKey: boolean,
): void {
  const payload = {
    abortReason,
    signalAborted,
    cancellationRequested,
    ownershipLost,
    runStatus,
    sessionState,
    ...createSafeProviderErrorDetails(error),
    heartbeatAt: null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    outcome: null,
    userSuppliedKey,
  };

  if (runStatus === "failed" && error !== null && !isHandledProviderFailure(error)) {
    captureChatWorkerTerminalStateException(
      context,
      payload,
      normalizeCaughtError(error),
    );
    return;
  }

  // Demote expected, user-actionable terminals to breadcrumbs instead of Sentry warnings.
  // context_length_exceeded already carries a clean "start a new chat" message and its root
  // cause is mitigated in the OpenAI loop; a rejected attachment is the user picking a file
  // the provider cannot read, and it is surfaced with the attachment guidance message; a
  // refused or exhausted own key is shown to its owner with OpenAI's own text. None is
  // actionable for us, so none should page as a warning. Provider-side and infrastructure
  // failures, and every failure of the platform key, stay warnings. The payload (including
  // providerErrorCode and userSuppliedKey) is unchanged, so the events stay fully searchable
  // in CloudWatch.
  const isExpectedUserTerminal = isContextLengthExceededError(error)
    || isChatAttachmentRejectedError(error)
    || (userSuppliedKey && isKeyOwnedProviderFailure(error));
  logChatWorkerTerminalStateEvent(
    context,
    payload,
    runStatus === "failed" && !isExpectedUserTerminal,
  );
}
