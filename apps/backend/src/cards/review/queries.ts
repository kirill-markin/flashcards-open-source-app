import {
  queryWithWorkspaceScopeReadOnly,
  transactionWithWorkspaceScopeReadOnly,
} from "../../database";
import {
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  type CursorPageInput,
} from "../../shared/pagination";
import {
  createCardQueryError,
  normalizeCardsQueryLimit,
} from "../querySupport";
import {
  CARD_SELECT,
  mapCard,
  mapReviewHistoryItem,
  toDate,
  toIsoString,
} from "../shared";
import type {
  Card,
  CardListPage,
  CardRow,
  ReviewHistoryPage,
  ReviewHistoryRow,
} from "../types";

const recentDuePriorityWindowMillis = 60 * 60 * 1000;

type DueCardsPageCursor = Readonly<{
  dueAt: string | null;
  createdAt: string;
  cardId: string;
}>;

type ReviewHistoryPageCursor = Readonly<{
  reviewedAtServer: string;
  reviewEventId: string;
}>;

type ReviewHistoryPageRow = ReviewHistoryRow & Readonly<{
  reviewed_at_server: Date | string;
}>;

function getReviewQueueRank(card: CardRow, nowTimestamp: number): number {
  if (card.due_at === null) {
    return 2;
  }

  const dueAtTimestamp = toDate(card.due_at).getTime();
  if (dueAtTimestamp > nowTimestamp) {
    return 3;
  }

  if (card.fsrs_last_reviewed_at !== null) {
    const fsrsLastReviewedAtTimestamp = toDate(card.fsrs_last_reviewed_at).getTime();
    if (
      fsrsLastReviewedAtTimestamp >= nowTimestamp - recentDuePriorityWindowMillis
      && fsrsLastReviewedAtTimestamp <= nowTimestamp
    ) {
      return 0;
    }
  }

  return 1;
}

function getReviewQueueDueTimestamp(card: CardRow): number {
  if (card.due_at === null) {
    return Number.POSITIVE_INFINITY;
  }

  return toDate(card.due_at).getTime();
}

function compareCardsForReviewQueue(leftCard: CardRow, rightCard: CardRow, nowTimestamp: number): number {
  const rankDifference = getReviewQueueRank(leftCard, nowTimestamp) - getReviewQueueRank(rightCard, nowTimestamp);
  if (rankDifference !== 0) {
    return rankDifference;
  }

  const leftDueTimestamp = getReviewQueueDueTimestamp(leftCard);
  const rightDueTimestamp = getReviewQueueDueTimestamp(rightCard);
  if (leftDueTimestamp !== rightDueTimestamp) {
    return leftDueTimestamp - rightDueTimestamp;
  }

  if (leftCard.due_at === null && rightCard.due_at === null) {
    const createdAtDifference = toDate(rightCard.created_at).getTime() - toDate(leftCard.created_at).getTime();
    if (createdAtDifference !== 0) {
      return createdAtDifference;
    }

    return leftCard.card_id.localeCompare(rightCard.card_id);
  }

  const createdAtDifference = toDate(rightCard.created_at).getTime() - toDate(leftCard.created_at).getTime();
  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return leftCard.card_id.localeCompare(rightCard.card_id);
}

function decodeDueCardsPageCursor(cursor: string): DueCardsPageCursor {
  const decodedCursor = decodeOpaqueCursor(cursor, "cursor");
  if (decodedCursor.values.length !== 3) {
    throw createCardQueryError("cursor does not match the requested due-cards order");
  }

  const dueAt = decodedCursor.values[0];
  const createdAt = decodedCursor.values[1];
  const cardId = decodedCursor.values[2];
  if ((typeof dueAt !== "string" && dueAt !== null) || typeof createdAt !== "string" || typeof cardId !== "string") {
    throw createCardQueryError("cursor does not match the requested due-cards order");
  }

  return {
    dueAt,
    createdAt,
    cardId,
  };
}

function decodeReviewHistoryPageCursor(cursor: string): ReviewHistoryPageCursor {
  const decodedCursor = decodeOpaqueCursor(cursor, "cursor");
  if (decodedCursor.values.length !== 2) {
    throw createCardQueryError("cursor does not match the requested review-history order");
  }

  const reviewedAtServer = decodedCursor.values[0];
  const reviewEventId = decodedCursor.values[1];
  if (typeof reviewedAtServer !== "string" || typeof reviewEventId !== "string") {
    throw createCardQueryError("cursor does not match the requested review-history order");
  }

  return {
    reviewedAtServer,
    reviewEventId,
  };
}

/**
 * Materializes the full due-card order for internal callers that must reason
 * about the exact queue as one collection.
 *
 * Keep this helper because `listReviewQueuePage()` currently derives stable
 * cursor pagination from the in-memory due order, which depends on null due
 * dates and `compareCardsForReviewQueue`. API-facing reads should call
 * `listReviewQueuePage()` instead.
 */
export async function listReviewQueue(
  userId: string,
  workspaceId: string,
  limit: number,
): Promise<ReadonlyArray<Card>> {
  return transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => {
    const now = new Date();
    const nowTimestamp = now.getTime();
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        "AND (due_at IS NULL OR due_at <= $2 OR fsrs_card_state = 'new')",
        "ORDER BY created_at DESC, card_id ASC",
      ].join(" "),
      [workspaceId, now],
    );

    return result.rows
      .filter((row) => row.due_at === null || toDate(row.due_at).getTime() <= nowTimestamp)
      .sort((leftRow, rightRow) => compareCardsForReviewQueue(leftRow, rightRow, nowTimestamp))
      .slice(0, limit)
      .map(mapCard);
  });
}

export async function listReviewQueuePage(
  userId: string,
  workspaceId: string,
  input: CursorPageInput,
): Promise<CardListPage> {
  const normalizedLimit = normalizeCardsQueryLimit(input.limit);
  const decodedCursor = input.cursor === null ? null : decodeDueCardsPageCursor(input.cursor);
  const dueCards = await listReviewQueue(userId, workspaceId, Number.MAX_SAFE_INTEGER);
  const startIndex = decodedCursor === null
    ? 0
    : dueCards.findIndex((card) => (
      card.dueAt === decodedCursor.dueAt
      && card.createdAt === decodedCursor.createdAt
      && card.cardId === decodedCursor.cardId
    )) + 1;
  if (decodedCursor !== null && startIndex === 0) {
    throw createCardQueryError("cursor does not match the requested due-cards order");
  }

  const visibleCards = dueCards.slice(startIndex, startIndex + normalizedLimit);
  const nextCard = dueCards[startIndex + normalizedLimit];
  const nextCursor = nextCard === undefined
    ? null
    : encodeOpaqueCursor([
      visibleCards[visibleCards.length - 1]?.dueAt ?? null,
      visibleCards[visibleCards.length - 1]?.createdAt ?? "",
      visibleCards[visibleCards.length - 1]?.cardId ?? "",
    ]);

  return {
    cards: visibleCards,
    nextCursor,
  };
}

export async function listReviewHistoryPage(
  userId: string,
  workspaceId: string,
  input: CursorPageInput & Readonly<{ cardId: string | null }>,
): Promise<ReviewHistoryPage> {
  const normalizedLimit = normalizeCardsQueryLimit(input.limit);
  const decodedCursor = input.cursor === null ? null : decodeReviewHistoryPageCursor(input.cursor);
  const cursorClause = decodedCursor === null
    ? ""
    : "AND (reviewed_at_server < $2 OR (reviewed_at_server = $2 AND review_event_id < $3))";
  const cardIdClause = input.cardId === null ? "" : decodedCursor === null ? "AND card_id = $2" : "AND card_id = $4";
  const params = input.cardId === null
    ? decodedCursor === null
      ? [workspaceId, normalizedLimit + 1]
      : [workspaceId, new Date(decodedCursor.reviewedAtServer), decodedCursor.reviewEventId, normalizedLimit + 1]
    : decodedCursor === null
      ? [workspaceId, input.cardId, normalizedLimit + 1]
      : [workspaceId, new Date(decodedCursor.reviewedAtServer), decodedCursor.reviewEventId, input.cardId, normalizedLimit + 1];
  const limitParamIndex = input.cardId === null
    ? decodedCursor === null ? 2 : 4
    : decodedCursor === null ? 3 : 5;

  const result = await queryWithWorkspaceScopeReadOnly<ReviewHistoryPageRow>(
    { userId, workspaceId },
    [
      "SELECT review_event_id, workspace_id, replica_id, client_event_id, card_id, rating, reviewed_at_client, reviewed_at_server, reviewed_time_zone",
      "FROM content.review_events",
      "WHERE workspace_id = $1",
      cursorClause,
      cardIdClause,
      "ORDER BY reviewed_at_server DESC, review_event_id DESC",
      `LIMIT $${limitParamIndex}`,
    ].join(" "),
    params,
  );

  const hasNextPage = result.rows.length > normalizedLimit;
  const visibleRows = hasNextPage ? result.rows.slice(0, normalizedLimit) : result.rows;
  const nextRow = hasNextPage ? visibleRows[visibleRows.length - 1] : undefined;

  return {
    history: visibleRows.map(mapReviewHistoryItem),
    nextCursor: nextRow === undefined ? null : encodeOpaqueCursor([
      toIsoString(nextRow.reviewed_at_server),
      nextRow.review_event_id,
    ]),
  };
}
