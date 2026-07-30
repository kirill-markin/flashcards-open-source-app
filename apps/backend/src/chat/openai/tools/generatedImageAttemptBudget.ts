import {
  transactionWithWorkspaceScopeDeadline,
  type DatabaseExecutor,
} from "../../../database";
import {
  assertActiveChatRunClaimWithExecutor,
  InactiveChatRunClaimError,
  type ChatRunClaimFenceParams,
} from "../../runs/claimFence";
import {
  reserveGeneratedCardImageAttemptForActiveRunWithExecutor,
  bindGeneratedCardImageAttemptPayloadForActiveRunWithExecutor,
  markGeneratedCardImageProviderStartedForActiveRunWithExecutor,
} from "../../runs/repository";

export const maximumGeneratedCardImageAttemptsPerRun = 3 as const;

export type GeneratedCardImageAttempt = 1 | 2 | 3;

export type GeneratedCardImageImmutablePayload = Readonly<{
  cardId: string;
  targetSide: "front" | "back";
  imagePrompt: string;
  altText: string;
}>;

export type GeneratedCardImageAttemptReservation =
  | Readonly<{
    status: "reserved";
    attempt: GeneratedCardImageAttempt;
    payload: GeneratedCardImageImmutablePayload | null;
  }>
  | Readonly<{ status: "limit_reached" }>
  | Readonly<{ status: "run_inactive" }>;

export type GeneratedCardImageAttemptReservationParams =
  ChatRunClaimFenceParams & Readonly<{
    operationKey: string;
    databaseDeadlineAtMs: number;
  }>;

export type BindGeneratedCardImageAttemptPayloadParams =
  ChatRunClaimFenceParams & Readonly<{
    operationKey: string;
    attempt: GeneratedCardImageAttempt;
    payload: GeneratedCardImageImmutablePayload;
    databaseDeadlineAtMs: number;
  }>;

export type MarkGeneratedCardImageProviderStartedParams =
  ChatRunClaimFenceParams & Readonly<{
    operationKey: string;
    databaseDeadlineAtMs: number;
  }>;

export type MarkGeneratedCardImageProviderStartedResult =
  | Readonly<{ status: "first_started" }>
  | Readonly<{ status: "previously_started" }>;

export async function reserveGeneratedCardImageAttemptWithExecutor(
  executor: DatabaseExecutor,
  params: GeneratedCardImageAttemptReservationParams,
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

export async function bindGeneratedCardImageAttemptPayloadWithExecutor(
  executor: DatabaseExecutor,
  params: BindGeneratedCardImageAttemptPayloadParams,
): Promise<GeneratedCardImageImmutablePayload> {
  await assertActiveChatRunClaimWithExecutor(executor, params);
  return bindGeneratedCardImageAttemptPayloadForActiveRunWithExecutor(executor, params);
}

export async function markGeneratedCardImageProviderStartedWithExecutor(
  executor: DatabaseExecutor,
  params: MarkGeneratedCardImageProviderStartedParams,
): Promise<MarkGeneratedCardImageProviderStartedResult> {
  await assertActiveChatRunClaimWithExecutor(executor, params);
  return markGeneratedCardImageProviderStartedForActiveRunWithExecutor(
    executor,
    params,
  );
}

export async function reserveGeneratedCardImageAttempt(
  params: GeneratedCardImageAttemptReservationParams,
): Promise<GeneratedCardImageAttemptReservation> {
  return transactionWithWorkspaceScopeDeadline(
    {
      userId: params.userId,
      workspaceId: params.workspaceId,
    },
    params.databaseDeadlineAtMs,
    async (executor) => reserveGeneratedCardImageAttemptWithExecutor(executor, params),
  );
}

export async function bindGeneratedCardImageAttemptPayload(
  params: BindGeneratedCardImageAttemptPayloadParams,
): Promise<GeneratedCardImageImmutablePayload> {
  return transactionWithWorkspaceScopeDeadline(
    {
      userId: params.userId,
      workspaceId: params.workspaceId,
    },
    params.databaseDeadlineAtMs,
    async (executor) => bindGeneratedCardImageAttemptPayloadWithExecutor(executor, params),
  );
}

export async function markGeneratedCardImageProviderStarted(
  params: MarkGeneratedCardImageProviderStartedParams,
): Promise<MarkGeneratedCardImageProviderStartedResult> {
  return transactionWithWorkspaceScopeDeadline(
    {
      userId: params.userId,
      workspaceId: params.workspaceId,
    },
    params.databaseDeadlineAtMs,
    async (executor) => markGeneratedCardImageProviderStartedWithExecutor(
      executor,
      params,
    ),
  );
}
