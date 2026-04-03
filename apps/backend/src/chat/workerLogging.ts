import { logCloudRouteEvent } from "../server/logging";

export type ChatWorkerLogContext = Readonly<{
  lambdaRequestId: string | null;
  chatRequestId: string | null;
  runId: string;
  sessionId: string | null;
  userId: string;
  workspaceId: string;
}>;

/**
 * Emits one structured chat-worker lifecycle event with the shared
 * correlation fields required for CloudWatch investigations.
 */
export function logChatWorkerLifecycleEvent(
  action: string,
  context: ChatWorkerLogContext,
  payload: Record<string, unknown>,
  isError: boolean,
): void {
  logCloudRouteEvent(action, {
    lambdaRequestId: context.lambdaRequestId,
    chatRequestId: context.chatRequestId,
    runId: context.runId,
    sessionId: context.sessionId,
    userId: context.userId,
    workspaceId: context.workspaceId,
    ...payload,
  }, isError);
}
