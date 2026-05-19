import {
  addBackendBreadcrumb,
  captureBackendException,
  captureBackendWarning,
  createBackendObservationScope,
  type BackendObservationScope,
  type ChatWorkerLifecycleDetails,
} from "../../observability/sentry";

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
  | "chat_worker_terminal_state_persisted"
  | "chat_worker_composer_suggestions_failed";

type ChatWorkerLifecyclePayload = Omit<ChatWorkerLifecycleDetails, "lambdaRequestId">;

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
  );
}

function createChatWorkerLifecycleDetails(
  context: ChatWorkerLogContext,
  payload: ChatWorkerLifecyclePayload,
): ChatWorkerLifecycleDetails {
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
  if (isError && (action === "chat_worker_terminal_state_persisted" || action === "chat_worker_composer_suggestions_failed")) {
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

export function captureChatWorkerTerminalStateException(
  context: ChatWorkerLogContext,
  payload: ChatWorkerLifecyclePayload,
  error: Error,
): void {
  captureBackendException({
    action: "chat_worker_terminal_state_persisted",
    error,
    scope: createChatWorkerScope(context),
    details: createChatWorkerLifecycleDetails(context, payload),
  });
}
