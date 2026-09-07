import { randomUUID } from "node:crypto";
import { submitReviewInExecutor } from "../cards/review/reviews";
import {
  queryWithWorkspaceScopeReadOnly,
  transactionWithWorkspaceScope,
} from "../database";
import { createPostCommitAnalyticsBudget } from "../productAnalytics/serverFacts/postCommitBudget";
import { runTransactionReportingReviewAnswers } from "../productAnalytics/serverFacts/reviewAnswers";
import type { FsrsCardState, ReviewRating } from "../scheduling";
import { HttpError } from "../shared/errors";
import { lockWorkspaceSyncMetadataForHotChangesInExecutor } from "../sync/replication/changes";
import { incomingLwwMetadataWins } from "../sync/conflicts/lww";
import { ensureAgentSyncReplica } from "./syncIdentity";
import {
  parseReviewRequest,
  submitReviewSchema,
  type AgentReviewInput,
} from "./reviewContract";

export type AgentReviewContext = Readonly<{
  userId: string;
  workspaceId: string;
  connectionId: string;
}>;

export type AgentReviewResult = Readonly<{
  workspaceId: string;
  cardId: string;
  reviewId: string;
  reviewEventId: string;
  rating: AgentReviewInput["rating"];
  reviewedAtClient: string;
  dueAt: string;
  intervalSeconds: number;
  scheduledDays: number;
  state: FsrsCardState;
  reps: number;
  lapses: number;
}>;

const ratings: Readonly<Record<AgentReviewInput["rating"], ReviewRating>> = {
  Again: 0,
  Hard: 1,
  Good: 2,
  Easy: 3,
};

export async function nextReviewCard(context: AgentReviewContext): Promise<
  Readonly<{
    workspaceId: string;
    card: Readonly<{ cardId: string; frontText: string }> | null;
  }>
> {
  const result = await queryWithWorkspaceScopeReadOnly<{
    card_id: string;
    front_text: string;
  }>(
    context,
    [
      "SELECT card_id, front_text FROM content.cards",
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
      "AND (due_at <= now() OR (due_at IS NULL AND fsrs_card_state = 'new'))",
      "ORDER BY due_at ASC NULLS LAST, created_at ASC, card_id ASC LIMIT 1",
    ].join(" "),
    [context.workspaceId],
  );
  const card = result.rows[0];
  return {
    workspaceId: context.workspaceId,
    card:
      card === undefined
        ? null
        : { cardId: card.card_id, frontText: card.front_text },
  };
}

export async function revealAnswer(
  context: AgentReviewContext,
  cardId: string,
): Promise<
  Readonly<{
    workspaceId: string;
    cardId: string;
    backText: string;
  }>
> {
  const result = await queryWithWorkspaceScopeReadOnly<{ back_text: string }>(
    context,
    "SELECT back_text FROM content.cards WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
    [context.workspaceId, cardId],
  );
  const card = result.rows[0];
  if (card === undefined) throw new HttpError(404, "Card not found");
  return { workspaceId: context.workspaceId, cardId, backText: card.back_text };
}

/** The receipt, event, schedule, progress facts, and hot change commit together.
 * Workspace locking serializes concurrent retries before consulting the receipt.
 * Receipts outlive hot-change retention and card tombstones; they contain no card text. */
export async function submitAgentReview(
  context: AgentReviewContext,
  request: AgentReviewInput,
): Promise<AgentReviewResult> {
  const parsed = parseReviewRequest(submitReviewSchema, request);
  if (
    parsed.workspaceId !== undefined &&
    parsed.workspaceId !== context.workspaceId
  ) {
    throw new HttpError(
      400,
      "workspaceId does not match the resolved workspace",
      "REVIEW_INPUT_INVALID",
    );
  }
  const input = {
    ...parsed,
    reviewedAtClient: new Date(parsed.reviewedAtClient).toISOString(),
  };
  const requestJson = JSON.stringify({
    cardId: input.cardId,
    rating: input.rating,
    reviewedAtClient: input.reviewedAtClient,
    reviewedTimeZone: input.reviewedTimeZone ?? null,
  });
  const replicaId = await ensureAgentSyncReplica(
    context.workspaceId,
    context.userId,
    context.connectionId,
  );
  return runTransactionReportingReviewAnswers(
    createPostCommitAnalyticsBudget(),
    (runInTransaction) =>
      transactionWithWorkspaceScope(context, runInTransaction),
    async (executor) => {
      const lock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(
        executor,
        context.workspaceId,
      );
      const receipt = await executor.query<{
        same_request: boolean;
        result: AgentReviewResult;
      }>(
        "SELECT request = $4::jsonb AS same_request, result FROM sync.agent_review_receipts WHERE workspace_id = $1 AND replica_id = $2 AND review_id = $3 AND user_id = security.current_user_id()",
        [context.workspaceId, replicaId, input.reviewId, requestJson],
      );
      const stored = receipt.rows[0];
      if (stored !== undefined) {
        if (!stored.same_request)
          throw new HttpError(
            409,
            "reviewId was already used with a different request",
            "REVIEW_ID_CONFLICT",
          );
        return stored.result;
      }

      // Online review must not overwrite a newer review or lower the LWW clock.
      // Offline first-party clients retain their existing snapshot/history sync path.
      const cardResult = await executor.query<{
        client_updated_at: Date;
        fsrs_last_reviewed_at: Date | null;
        last_modified_by_replica_id: string;
        last_operation_id: string;
      }>(
        "SELECT client_updated_at, fsrs_last_reviewed_at, last_modified_by_replica_id, last_operation_id FROM content.cards WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL FOR UPDATE",
        [context.workspaceId, input.cardId],
      );
      const current = cardResult.rows[0];
      if (current === undefined) throw new HttpError(404, "Card not found");
      const reviewedAt = new Date(input.reviewedAtClient).getTime();
      if (
        !incomingLwwMetadataWins(
          {
            clientUpdatedAt: input.reviewedAtClient,
            lastModifiedByReplicaId: replicaId,
            lastOperationId: `agent-review:${input.reviewId}`,
          },
          {
            clientUpdatedAt: new Date(current.client_updated_at).toISOString(),
            lastModifiedByReplicaId: current.last_modified_by_replica_id,
            lastOperationId: current.last_operation_id,
          },
        ) ||
        (current.fsrs_last_reviewed_at !== null &&
          reviewedAt <= new Date(current.fsrs_last_reviewed_at).getTime())
      ) {
        throw new HttpError(
          409,
          "The card changed after this review time. Reload the card; do not change the timestamp to force a retry.",
          "REVIEW_STALE",
        );
      }
      if (reviewedAt > Date.now() + 5 * 60_000) {
        throw new HttpError(
          400,
          "reviewedAtClient must not be more than five minutes in the future",
          "REVIEW_INPUT_INVALID",
        );
      }
      const reviewEventId = randomUUID();
      const reviewed = await submitReviewInExecutor(
        executor,
        context.workspaceId,
        replicaId,
        {
          cardId: input.cardId,
          rating: ratings[input.rating],
          reviewedAtClient: input.reviewedAtClient,
          reviewedTimeZone: input.reviewedTimeZone,
          reviewEventId,
          clientEventId: `agent-review:${input.reviewId}`,
        },
        {
          clientUpdatedAt: input.reviewedAtClient,
          lastModifiedByReplicaId: replicaId,
          lastOperationId: `agent-review:${input.reviewId}`,
        },
        lock,
      );
      if (reviewed.card.fsrsScheduledDays === null) {
        throw new Error("Review scheduling did not return scheduled days");
      }
      const result: AgentReviewResult = {
        workspaceId: context.workspaceId,
        cardId: input.cardId,
        reviewId: input.reviewId,
        reviewEventId,
        rating: input.rating,
        reviewedAtClient: input.reviewedAtClient,
        dueAt: reviewed.nextDueAt,
        intervalSeconds:
          (new Date(reviewed.nextDueAt).getTime() - reviewedAt) / 1000,
        scheduledDays: reviewed.card.fsrsScheduledDays,
        state: reviewed.card.fsrsCardState,
        reps: reviewed.card.reps,
        lapses: reviewed.card.lapses,
      };
      await executor.query(
        "INSERT INTO sync.agent_review_receipts (workspace_id, replica_id, review_id, user_id, request, result) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)",
        [
          context.workspaceId,
          replicaId,
          input.reviewId,
          context.userId,
          requestJson,
          JSON.stringify(result),
        ],
      );
      return result;
    },
  );
}
