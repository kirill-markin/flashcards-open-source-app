import { randomUUID } from "node:crypto";
import type { ReviewResult } from "../cards/types";
import { submitReviewInExecutor } from "../cards/review/reviews";
import {
  queryWithWorkspaceScopeReadOnly,
  transactionWithWorkspaceScope,
} from "../database";
import { getDeck } from "../decks";
import { createPostCommitAnalyticsBudget } from "../productAnalytics/serverFacts/postCommitBudget";
import { runTransactionReportingReviewAnswers } from "../productAnalytics/serverFacts/reviewAnswers";
import type { FsrsCardState, ReviewRating } from "../scheduling";
import { HttpError, type ReviewScheduleErrorDetails } from "../shared/errors";
import { lockWorkspaceSyncMetadataForHotChangesInExecutor } from "../sync/replication/changes";
import { ensureAgentSyncReplica } from "./syncIdentity";
import {
  parseReviewRequest,
  submitReviewSchema,
  type AgentReviewCardFilter,
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
  reviewedAt: string;
  dueAt: string;
  intervalSeconds: number;
  scheduledDays: number;
  state: FsrsCardState;
  reps: number;
  lapses: number;
}>;

type CardScheduleRow = Readonly<{
  due_at: Date | null;
  reps: number;
  lapses: number;
  fsrs_card_state: FsrsCardState;
  fsrs_scheduled_days: number | null;
  fsrs_last_reviewed_at: Date | null;
}>;

const ratings: Readonly<Record<AgentReviewInput["rating"], ReviewRating>> = {
  Again: 0,
  Hard: 1,
  Good: 2,
  Easy: 3,
};

/** Resolves the requested filter to the tag list the card query must match, or null for every card.
 * A deck carries no cards: content.decks.filter_definition is a saved tag filter, and an empty one
 * selects the whole workspace, while an explicitly empty tags request selects nothing. */
async function resolveReviewFilterTags(
  context: AgentReviewContext,
  filter: AgentReviewCardFilter,
): Promise<ReadonlyArray<string> | null> {
  if (filter.kind === "allCards") {
    return null;
  }

  if (filter.kind === "tags") {
    return filter.tags;
  }

  const deck = await getDeck(context.userId, context.workspaceId, filter.deckId);
  return deck.filterDefinition.tags.length === 0
    ? null
    : deck.filterDefinition.tags;
}

const recentlyReviewedWindow =
  "fsrs_last_reviewed_at BETWEEN now() - INTERVAL '1 hour' AND now()";

/** The review queue in presentation order: due cards reviewed within the last hour, then the other
 * due cards, then new cards. Keep the ranks, the one-hour window and the tie-breaks in sync with
 * apps/web/src/localDb/reviews/reviews.ts, apps/ios/.../CardStore+ReadSQL.swift and
 * apps/android/.../ReviewCardSelectionDao.kt, and with docs/fsrs-scheduling-logic.md. */
const reviewQueueBuckets: ReadonlyArray<
  Readonly<{ condition: string; tieBreaks: string }>
> = [
  {
    condition: `due_at <= now() AND ${recentlyReviewedWindow}`,
    tieBreaks: "due_at ASC, created_at ASC, card_id ASC",
  },
  {
    condition: `due_at <= now() AND (fsrs_last_reviewed_at IS NULL OR NOT (${recentlyReviewedWindow}))`,
    tieBreaks: "due_at ASC, created_at ASC, card_id ASC",
  },
  {
    condition: "due_at IS NULL",
    tieBreaks: "created_at ASC, card_id ASC",
  },
];

/** Reads every bucket as its own LIMIT 1 query, the way the clients read theirs.
 * idx_cards_workspace_due_active bounds both due buckets and supplies their leading due_at order.
 * No index carries the new-card bucket's created_at ASC, card_id ASC order, and UNION ALL evaluates
 * that bucket even when a due bucket already has a candidate, so every call top-N sorts the
 * workspace's new cards. */
function buildNextReviewCardQuery(tagFilter: string): string {
  const bucketQueries = reviewQueueBuckets.map((bucket, rank) =>
    [
      `(SELECT ${rank} AS bucket, card_id, front_text FROM content.cards`,
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
      `AND ${bucket.condition}`,
      tagFilter,
      `ORDER BY ${bucket.tieBreaks} LIMIT 1)`,
    ].join(" "),
  );

  return [
    "SELECT card_id, front_text FROM (",
    bucketQueries.join(" UNION ALL "),
    ") AS bucket_candidates ORDER BY bucket ASC LIMIT 1",
  ].join(" ");
}

export async function nextReviewCard(
  context: AgentReviewContext,
  filter: AgentReviewCardFilter,
): Promise<
  Readonly<{
    workspaceId: string;
    card: Readonly<{ cardId: string; frontText: string }> | null;
  }>
> {
  const filterTags = await resolveReviewFilterTags(context, filter);
  const result = await queryWithWorkspaceScopeReadOnly<{
    card_id: string;
    front_text: string;
  }>(
    context,
    buildNextReviewCardQuery(
      filterTags === null ? "" : "AND tags && $2::text[]",
    ),
    filterTags === null
      ? [context.workspaceId]
      : [context.workspaceId, filterTags],
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

function toReviewScheduleDetails(
  cardId: string,
  card: CardScheduleRow,
): ReviewScheduleErrorDetails {
  const dueAt = card.due_at === null ? null : new Date(card.due_at);
  const lastReviewedAt =
    card.fsrs_last_reviewed_at === null
      ? null
      : new Date(card.fsrs_last_reviewed_at);
  return {
    cardId,
    dueAt: dueAt === null ? null : dueAt.toISOString(),
    // A stored review instant later than due_at describes no interval, so the field stays null
    // instead of reporting a negative delay beside a correct future dueAt.
    intervalSeconds:
      dueAt === null ||
      lastReviewedAt === null ||
      lastReviewedAt.getTime() > dueAt.getTime()
        ? null
        : (dueAt.getTime() - lastReviewedAt.getTime()) / 1000,
    scheduledDays: card.fsrs_scheduled_days,
    state: card.fsrs_card_state,
    reps: card.reps,
    lapses: card.lapses,
  };
}

/** The contractual duplicate answer: the review is refused and the card's stored schedule travels
 * with it, so a retry whose review already landed can report when the card is next due. */
function createReviewEventConflictError(
  cardId: string,
  card: CardScheduleRow,
  cause: unknown,
): HttpError {
  return new HttpError(
    409,
    "This review was already recorded. The card's current schedule is in details.reviewSchedule.",
    "REVIEW_EVENT_CONFLICT",
    { reviewSchedule: toReviewScheduleDetails(cardId, card) },
    cause,
  );
}

/** The review event, schedule, progress facts, and hot change commit together.
 * Retry safety is the UNIQUE (workspace_id, replica_id, client_event_id) constraint on
 * content.review_events: a repeated reviewId dedupes there and never advances the schedule. */
export async function submitAgentReview(
  context: AgentReviewContext,
  request: AgentReviewInput,
): Promise<AgentReviewResult> {
  const input = parseReviewRequest(submitReviewSchema, request);
  if (
    input.workspaceId !== undefined &&
    input.workspaceId !== context.workspaceId
  ) {
    throw new HttpError(
      400,
      "workspaceId does not match the resolved workspace",
      "REVIEW_INPUT_INVALID",
    );
  }
  const replicaId = await ensureAgentSyncReplica(
    context.workspaceId,
    context.userId,
    context.connectionId,
  );
  const clientEventId = `agent-review:${input.reviewId}`;
  return runTransactionReportingReviewAnswers(
    createPostCommitAnalyticsBudget(),
    (runInTransaction) =>
      transactionWithWorkspaceScope(context, runInTransaction),
    async (executor) => {
      const lock = await lockWorkspaceSyncMetadataForHotChangesInExecutor(
        executor,
        context.workspaceId,
      );
      // This surface is online only, so the server owns the review instant, like every other agent
      // write. Stamping under the lock means no writer can move fsrs_last_reviewed_at between this
      // stamp and the locked read below. Nothing bounds that column by server time, though: a
      // client-stamped review can store an instant ahead of this stamp.
      const reviewedAt = new Date();
      const reviewedAtIso = reviewedAt.toISOString();
      const cardResult = await executor.query<CardScheduleRow>(
        "SELECT due_at, reps, lapses, fsrs_card_state, fsrs_scheduled_days, fsrs_last_reviewed_at FROM content.cards WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL FOR UPDATE",
        [context.workspaceId, input.cardId],
      );
      const current = cardResult.rows[0];
      if (current === undefined) throw new HttpError(404, "Card not found");
      // computeReviewSchedule rejects a review that predates fsrs_last_reviewed_at, so answer the
      // clock skew as a conflict instead of letting the scheduler fail the request as a 500.
      if (
        current.fsrs_last_reviewed_at !== null &&
        reviewedAt.getTime() <= new Date(current.fsrs_last_reviewed_at).getTime()
      ) {
        // A stored instant at or after this stamp comes from a client-stamped review of the same
        // card, which can have landed after this reviewId's own review did. A landed duplicate
        // owes the caller its schedule instead of this skew report.
        const duplicate = await executor.query<{ review_event_id: string }>(
          "SELECT review_event_id FROM content.review_events WHERE workspace_id = $1 AND replica_id = $2 AND client_event_id = $3",
          [context.workspaceId, replicaId, clientEventId],
        );
        if (duplicate.rows[0] !== undefined) {
          throw createReviewEventConflictError(input.cardId, current, undefined);
        }

        throw new HttpError(
          409,
          "The card's stored review time is at or after the current server time, so it cannot be reviewed again until server time passes that instant.",
          "REVIEW_STALE",
        );
      }
      const reviewEventId = randomUUID();
      let reviewed: ReviewResult;
      try {
        reviewed = await submitReviewInExecutor(
          executor,
          context.workspaceId,
          replicaId,
          {
            cardId: input.cardId,
            rating: ratings[input.rating],
            reviewedAtClient: reviewedAtIso,
            reviewedTimeZone: input.reviewedTimeZone,
            reviewEventId,
            clientEventId,
          },
          {
            clientUpdatedAt: reviewedAtIso,
            lastModifiedByReplicaId: replicaId,
            lastOperationId: clientEventId,
          },
          lock,
        );
      } catch (error) {
        if (error instanceof HttpError && error.code === "REVIEW_EVENT_CONFLICT") {
          throw createReviewEventConflictError(input.cardId, current, error);
        }
        throw error;
      }
      if (reviewed.card.fsrsScheduledDays === null) {
        throw new Error("Review scheduling did not return scheduled days");
      }
      return {
        workspaceId: context.workspaceId,
        cardId: input.cardId,
        reviewId: input.reviewId,
        reviewEventId,
        rating: input.rating,
        reviewedAt: reviewedAtIso,
        dueAt: reviewed.nextDueAt,
        intervalSeconds:
          (new Date(reviewed.nextDueAt).getTime() - reviewedAt.getTime()) / 1000,
        scheduledDays: reviewed.card.fsrsScheduledDays,
        state: reviewed.card.fsrsCardState,
        reps: reviewed.card.reps,
        lapses: reviewed.card.lapses,
      };
    },
  );
}
