import { queryWithWorkspaceScopeReadOnly } from "../../database";
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
  mapReviewHistoryItem,
  toIsoString,
} from "../shared";
import type {
  ReviewHistoryPage,
  ReviewHistoryRow,
} from "../types";

type ReviewHistoryPageCursor = Readonly<{
  reviewedAtServer: string;
  reviewEventId: string;
}>;

type ReviewHistoryPageRow = ReviewHistoryRow & Readonly<{
  reviewed_at_server: Date | string;
}>;

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
