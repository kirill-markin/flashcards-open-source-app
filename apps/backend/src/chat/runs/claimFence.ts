import type {
  DatabaseExecutor,
  WorkspaceDatabaseScope,
} from "../../database";
import {
  selectChatRunClaimForUpdateWithExecutor,
  selectSessionForUpdateWithExecutor,
} from "./repository";
import type { ChatRunClaimToken } from "./types";

export type ChatRunClaimFenceParams = WorkspaceDatabaseScope & Readonly<{
  runId: string;
  sessionId: string;
  claimToken: ChatRunClaimToken;
}>;

export type ChatRunClaimState = "active" | "cancellation_requested" | "ownership_lost";

export class InactiveChatRunClaimError extends Error {
  public constructor(runId: string) {
    super(`Chat run claim is no longer active: ${runId}`);
    this.name = "InactiveChatRunClaimError";
  }
}

/**
 * Locks and verifies a worker claim inside the caller's existing transaction.
 */
export async function getChatRunClaimStateWithExecutor(
  executor: DatabaseExecutor,
  params: ChatRunClaimFenceParams,
): Promise<ChatRunClaimState> {
  const scope = {
    userId: params.userId,
    workspaceId: params.workspaceId,
  };
  const run = await selectChatRunClaimForUpdateWithExecutor(
    executor,
    scope,
    params.runId,
  );
  if (run === null) {
    return "ownership_lost";
  }

  const session = await selectSessionForUpdateWithExecutor(executor, scope, run.session_id);
  if (
    run.session_id !== params.sessionId
    || run.status !== "running"
    || run.worker_claimed_at !== params.claimToken
    || session.status !== "running"
    || session.active_run_id !== run.run_id
  ) {
    return "ownership_lost";
  }
  return run.cancel_requested_at === null ? "active" : "cancellation_requested";
}

export async function assertActiveChatRunClaimWithExecutor(
  executor: DatabaseExecutor,
  params: ChatRunClaimFenceParams,
): Promise<void> {
  if (await getChatRunClaimStateWithExecutor(executor, params) !== "active") {
    throw new InactiveChatRunClaimError(params.runId);
  }
}
