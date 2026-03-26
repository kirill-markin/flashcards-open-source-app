/**
 * Worker entrypoint for backend-owned chat runs.
 * The HTTP route prepares and persists the run; the worker claims it and executes the model loop independently of the client connection.
 */
import { logCloudRouteEvent } from "../server/logging";
import { claimChatRun } from "./runs";
import { runPersistedChatSession } from "./runtime";

export type ChatWorkerEvent = Readonly<{
  runId: string;
  userId: string;
  workspaceId: string;
}>;

/**
 * Claims and executes one persisted chat run if it is still pending.
 */
export async function handleChatWorkerEvent(event: ChatWorkerEvent): Promise<void> {
  const claimedRun = await claimChatRun(event.userId, event.workspaceId, event.runId);
  if (claimedRun === null) {
    logCloudRouteEvent("chat_worker_skip", {
      runId: event.runId,
      userId: event.userId,
      workspaceId: event.workspaceId,
    }, false);
    return;
  }

  logCloudRouteEvent("chat_worker_start", {
    runId: claimedRun.runId,
    sessionId: claimedRun.sessionId,
    userId: claimedRun.userId,
    workspaceId: claimedRun.workspaceId,
  }, false);

  await runPersistedChatSession({
    runId: claimedRun.runId,
    requestId: claimedRun.requestId,
    userId: claimedRun.userId,
    workspaceId: claimedRun.workspaceId,
    sessionId: claimedRun.sessionId,
    timezone: claimedRun.timezone,
    assistantItemId: claimedRun.assistantItemId,
    localMessages: claimedRun.localMessages,
    turnInput: claimedRun.turnInput,
    diagnostics: claimedRun.diagnostics,
  });

  logCloudRouteEvent("chat_worker_finish", {
    runId: claimedRun.runId,
    sessionId: claimedRun.sessionId,
    userId: claimedRun.userId,
    workspaceId: claimedRun.workspaceId,
  }, false);
}
