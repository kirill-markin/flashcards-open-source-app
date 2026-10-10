import { getDatabaseErrorFields } from "../../database/transient";
import { writeCloudWatchRecord } from "../../observability/cloudWatch";
import {
  addBackendBreadcrumb,
  captureBackendException,
  captureBackendWarning,
  captureBackendWarningWithFingerprint,
  createBackendObservationScope,
  getBackendErrorLogDetails,
  type BackendObservationScope,
  type ChatWorkerLifecycleDetails,
  type ChatWorkerTerminalStateDetails,
} from "../../observability/sentry";
import { createChatTerminalWarningFingerprint } from "../runtime/providerErrors";

export type ChatWorkerLogContext = Readonly<{
  lambdaRequestId: string | null;
  chatRequestId: string | null;
  runId: string;
  sessionId: string | null;
  userId: string;
  workspaceId: string;
}>;

export type ChatWorkerLifecycleAction =
  | "chat_worker_skip"
  | "chat_worker_claimed"
  | "chat_worker_finish"
  | "chat_worker_abort_requested"
  | "chat_worker_provider_call_started"
  | "chat_worker_provider_call_aborted"
  | "chat_worker_composer_suggestions_failed";

type ChatWorkerLifecyclePayload = Omit<ChatWorkerLifecycleDetails, "lambdaRequestId">;

export type ChatWorkerTerminalStatePayload = Omit<ChatWorkerTerminalStateDetails, "lambdaRequestId">;

function createChatWorkerScope(context: ChatWorkerLogContext): BackendObservationScope {
  return createBackendObservationScope(
    "chat-worker",
    context.lambdaRequestId,
    null,
    null,
    context.userId,
    context.workspaceId,
    context.chatRequestId,
    context.runId,
    context.sessionId,
    null,
    null,
  );
}

function createChatWorkerLifecycleDetails<Payload extends ChatWorkerLifecyclePayload>(
  context: ChatWorkerLogContext,
  payload: Payload,
): Readonly<{ lambdaRequestId: string | null }> & Payload {
  return {
    lambdaRequestId: context.lambdaRequestId,
    ...payload,
  };
}

/**
 * Emits one structured chat-worker lifecycle event with the shared
 * correlation fields required for CloudWatch investigations.
 */
export function logChatWorkerLifecycleEvent(
  action: ChatWorkerLifecycleAction,
  context: ChatWorkerLogContext,
  payload: ChatWorkerLifecyclePayload,
  isError: boolean,
): void {
  const scope = createChatWorkerScope(context);
  const details = createChatWorkerLifecycleDetails(context, payload);
  if (isError && action === "chat_worker_composer_suggestions_failed") {
    captureBackendWarning({
      action,
      message: `${action} warning`,
      scope,
      details,
    });
    return;
  }

  addBackendBreadcrumb({
    action,
    scope,
    details,
  });
}

/**
 * Emits the `chat_worker_terminal_state_persisted` record: a fingerprinted Sentry warning when `isError`
 * is set, otherwise a breadcrumb that still writes the CloudWatch record.
 */
export function logChatWorkerTerminalStateEvent(
  context: ChatWorkerLogContext,
  payload: ChatWorkerTerminalStatePayload,
  isError: boolean,
): void {
  const action = "chat_worker_terminal_state_persisted";
  const scope = createChatWorkerScope(context);
  const details = createChatWorkerLifecycleDetails(context, payload);
  if (isError) {
    captureBackendWarningWithFingerprint({
      action,
      message: `${action} warning`,
      scope,
      details,
    }, createChatTerminalWarningFingerprint(details));
    return;
  }

  addBackendBreadcrumb({
    action,
    scope,
    details,
  });
}

export function logChatWorkerHeartbeatFailed(
  context: ChatWorkerLogContext,
  error: unknown,
  elapsedMs: number,
  timerLagMs: number,
): void {
  const errorDetails = getBackendErrorLogDetails(error);
  writeCloudWatchRecord({
    action: "chat_worker_heartbeat_failed",
    message: "Chat run heartbeat failed.",
    scope: createChatWorkerScope(context),
    details: {
      lambdaRequestId: context.lambdaRequestId,
      errorClass: errorDetails.errorClass,
      errorMessage: errorDetails.errorMessage,
      sqlState: getDatabaseErrorFields(error).sqlState,
      elapsedMs,
      timerLagMs,
    },
  }, "warning");
}

export function logChatWorkerHeartbeatSkipped(
  context: ChatWorkerLogContext,
  pendingMs: number,
): void {
  writeCloudWatchRecord({
    action: "chat_worker_heartbeat_skipped",
    message: "Chat run heartbeat tick skipped because the previous heartbeat is still pending.",
    scope: createChatWorkerScope(context),
    details: {
      lambdaRequestId: context.lambdaRequestId,
      pendingMs,
    },
  }, "warning");
}

export function logChatWorkerHeartbeatTimerLagged(
  context: ChatWorkerLogContext,
  timerLagMs: number,
  executionPhase: string,
  toolName: string | null,
): void {
  writeCloudWatchRecord({
    action: "chat_worker_heartbeat_timer_lagged",
    message: "Chat run heartbeat timer fired late because the event loop was blocked.",
    scope: createChatWorkerScope(context),
    details: {
      lambdaRequestId: context.lambdaRequestId,
      timerLagMs,
      executionPhase,
      toolName,
    },
  }, "warning");
}

export function captureChatWorkerTerminalStateException(
  context: ChatWorkerLogContext,
  payload: ChatWorkerTerminalStatePayload,
  error: Error,
): void {
  captureBackendException({
    action: "chat_worker_terminal_state_persisted",
    error,
    scope: createChatWorkerScope(context),
    details: createChatWorkerLifecycleDetails(context, payload),
  });
}
