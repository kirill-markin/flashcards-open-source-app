import type {
  DatabaseExecutor,
  WorkspaceDatabaseScope,
} from "../../database";
import type { AiChatRunClientDevice } from "../../productAnalytics/serverFacts/reviewAnswers";
import {
  selectChatRunClaimForUpdateWithExecutor,
  selectSessionForUpdateWithExecutor,
  type ChatRunClaimRow,
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

type ChatRunClaimCheck =
  | Readonly<{ state: "ownership_lost" }>
  | Readonly<{ state: "active" | "cancellation_requested"; run: ChatRunClaimRow }>;

/**
 * Locks and verifies a worker claim inside the caller's existing transaction.
 */
async function checkChatRunClaimWithExecutor(
  executor: DatabaseExecutor,
  params: ChatRunClaimFenceParams,
): Promise<ChatRunClaimCheck> {
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
    return { state: "ownership_lost" };
  }

  const session = await selectSessionForUpdateWithExecutor(executor, scope, run.session_id);
  if (
    run.session_id !== params.sessionId
    || run.status !== "running"
    || run.worker_claimed_at !== params.claimToken
    || session.status !== "running"
    || session.active_run_id !== run.run_id
  ) {
    return { state: "ownership_lost" };
  }
  return { state: run.cancel_requested_at === null ? "active" : "cancellation_requested", run };
}

export async function getChatRunClaimStateWithExecutor(
  executor: DatabaseExecutor,
  params: ChatRunClaimFenceParams,
): Promise<ChatRunClaimState> {
  return (await checkChatRunClaimWithExecutor(executor, params)).state;
}

/** The stored device of a claimed run, or null when its claim is no longer active. */
export async function getActiveChatRunClientDeviceWithExecutor(
  executor: DatabaseExecutor,
  params: ChatRunClaimFenceParams,
): Promise<AiChatRunClientDevice | null> {
  const check = await checkChatRunClaimWithExecutor(executor, params);
  if (check.state !== "active") {
    return null;
  }
  return {
    platform: check.run.client_platform,
    osName: check.run.client_os_name,
    deviceType: check.run.client_device_type,
  };
}

export async function assertActiveChatRunClaimWithExecutor(
  executor: DatabaseExecutor,
  params: ChatRunClaimFenceParams,
): Promise<void> {
  if (await getChatRunClaimStateWithExecutor(executor, params) !== "active") {
    throw new InactiveChatRunClaimError(params.runId);
  }
}
