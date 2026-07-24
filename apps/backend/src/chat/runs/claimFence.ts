import type {
  DatabaseExecutor,
  WorkspaceDatabaseScope,
} from "../../database";
import {
  selectChatRunForUpdateWithExecutor,
  selectSessionForUpdateWithExecutor,
} from "./repository";
import type { ChatRunClaimToken } from "./types";

export type ChatRunClaimFenceParams = WorkspaceDatabaseScope & Readonly<{
  runId: string;
  sessionId: string;
  claimToken: ChatRunClaimToken;
}>;

export class InactiveChatRunClaimError extends Error {
  public constructor(runId: string) {
    super(`Chat run claim is no longer active: ${runId}`);
    this.name = "InactiveChatRunClaimError";
  }
}

/**
 * Locks and verifies a worker claim inside the caller's existing transaction.
 */
export async function assertActiveChatRunClaimWithExecutor(
  executor: DatabaseExecutor,
  params: ChatRunClaimFenceParams,
): Promise<void> {
  const scope = {
    userId: params.userId,
    workspaceId: params.workspaceId,
  };
  const run = await selectChatRunForUpdateWithExecutor(executor, scope, params.runId);
  if (run === null) {
    throw new InactiveChatRunClaimError(params.runId);
  }

  const session = await selectSessionForUpdateWithExecutor(executor, scope, run.session_id);
  if (
    run.session_id !== params.sessionId
    || run.status !== "running"
    || run.cancel_requested_at !== null
    || run.worker_claimed_at !== params.claimToken
    || session.status !== "running"
    || session.active_run_id !== run.run_id
  ) {
    throw new InactiveChatRunClaimError(params.runId);
  }
}
