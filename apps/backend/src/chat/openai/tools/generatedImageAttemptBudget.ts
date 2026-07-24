import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
} from "../../../database";
import {
  assertActiveChatRunClaimWithExecutor,
  InactiveChatRunClaimError,
  type ChatRunClaimFenceParams,
} from "../../runs/claimFence";
import {
  reserveGeneratedCardImageAttemptForActiveRunWithExecutor,
} from "../../runs/repository";

export const maximumGeneratedCardImageAttemptsPerRun = 3 as const;

export type GeneratedCardImageAttemptReservation =
  | Readonly<{ status: "reserved"; attempt: 1 | 2 | 3 }>
  | Readonly<{ status: "limit_reached" }>
  | Readonly<{ status: "run_inactive" }>;

export async function reserveGeneratedCardImageAttemptWithExecutor(
  executor: DatabaseExecutor,
  params: ChatRunClaimFenceParams,
): Promise<GeneratedCardImageAttemptReservation> {
  try {
    await assertActiveChatRunClaimWithExecutor(executor, params);
  } catch (error) {
    if (error instanceof InactiveChatRunClaimError) {
      return { status: "run_inactive" };
    }
    throw error;
  }

  return reserveGeneratedCardImageAttemptForActiveRunWithExecutor(
    executor,
    params,
    maximumGeneratedCardImageAttemptsPerRun,
  );
}

export async function reserveGeneratedCardImageAttempt(
  params: ChatRunClaimFenceParams,
): Promise<GeneratedCardImageAttemptReservation> {
  return transactionWithWorkspaceScope(
    {
      userId: params.userId,
      workspaceId: params.workspaceId,
    },
    async (executor) => reserveGeneratedCardImageAttemptWithExecutor(executor, params),
  );
}
