import { query, transaction } from "../db";
import { HttpError } from "../errors";
import { validateOrResetCardRowForRead } from "./fsrs";
import {
  CARD_SELECT,
  mapCard,
  mapDeckSummary,
  mapReviewHistoryItem,
  toDate,
} from "./shared";
import type {
  Card,
  CardRow,
  DeckSummary,
  DeckSummaryRow,
  ReviewHistoryItem,
  ReviewHistoryRow,
} from "./types";

async function validateOrResetCardRowsForRead(
  executor: Parameters<typeof validateOrResetCardRowForRead>[0],
  workspaceId: string,
  rows: ReadonlyArray<CardRow>,
): Promise<ReadonlyArray<CardRow>> {
  const repairedRows: Array<CardRow> = [];
  for (const row of rows) {
    repairedRows.push(await validateOrResetCardRowForRead(executor, workspaceId, row));
  }

  return repairedRows;
}

function compareCardsForReviewQueue(leftCard: CardRow, rightCard: CardRow): number {
  if (leftCard.due_at === null && rightCard.due_at === null) {
    return toDate(rightCard.updated_at).getTime() - toDate(leftCard.updated_at).getTime();
  }

  if (leftCard.due_at === null) {
    return -1;
  }

  if (rightCard.due_at === null) {
    return 1;
  }

  const dueDifference = toDate(leftCard.due_at).getTime() - toDate(rightCard.due_at).getTime();
  if (dueDifference !== 0) {
    return dueDifference;
  }

  return toDate(rightCard.updated_at).getTime() - toDate(leftCard.updated_at).getTime();
}

export async function listCards(workspaceId: string): Promise<ReadonlyArray<Card>> {
  return transaction(async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1 AND deleted_at IS NULL",
        "ORDER BY updated_at DESC",
      ].join(" "),
      [workspaceId],
    );

    const repairedRows = await validateOrResetCardRowsForRead(executor, workspaceId, result.rows);
    return repairedRows.map(mapCard);
  });
}

export async function getCard(workspaceId: string, cardId: string): Promise<Card> {
  return transaction(async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1 AND card_id = $2 AND deleted_at IS NULL",
      ].join(" "),
      [workspaceId, cardId],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new HttpError(404, "Card not found");
    }

    return mapCard(await validateOrResetCardRowForRead(executor, workspaceId, row));
  });
}

export async function listReviewQueue(
  workspaceId: string,
  limit: number,
): Promise<ReadonlyArray<Card>> {
  return transaction(async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        "AND (due_at IS NULL OR due_at <= now() OR fsrs_card_state = 'new')",
        "ORDER BY updated_at DESC",
      ].join(" "),
      [workspaceId],
    );

    const repairedRows = await validateOrResetCardRowsForRead(executor, workspaceId, result.rows);
    return repairedRows
      .filter((row) => row.due_at === null || toDate(row.due_at).getTime() <= Date.now())
      .sort(compareCardsForReviewQueue)
      .slice(0, limit)
      .map(mapCard);
  });
}

export async function searchCards(
  workspaceId: string,
  searchText: string,
  limit: number,
): Promise<ReadonlyArray<Card>> {
  const likeValue = `%${searchText}%`;
  return transaction(async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        "AND (front_text ILIKE $2 OR back_text ILIKE $2 OR EXISTS (",
        "SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE $2",
        "))",
        "ORDER BY updated_at DESC",
        "LIMIT $3",
      ].join(" "),
      [workspaceId, likeValue, limit],
    );

    const repairedRows = await validateOrResetCardRowsForRead(executor, workspaceId, result.rows);
    return repairedRows.map(mapCard);
  });
}

export async function listReviewHistory(
  workspaceId: string,
  limit: number,
  cardId?: string,
): Promise<ReadonlyArray<ReviewHistoryItem>> {
  const result = cardId === undefined
    ? await query<ReviewHistoryRow>(
      [
        "SELECT review_event_id, workspace_id, device_id, client_event_id, card_id, rating, reviewed_at_client, reviewed_at_server",
        "FROM content.review_events",
        "WHERE workspace_id = $1",
        "ORDER BY reviewed_at_server DESC",
        "LIMIT $2",
      ].join(" "),
      [workspaceId, limit],
    )
    : await query<ReviewHistoryRow>(
      [
        "SELECT review_event_id, workspace_id, device_id, client_event_id, card_id, rating, reviewed_at_client, reviewed_at_server",
        "FROM content.review_events",
        "WHERE workspace_id = $1 AND card_id = $2",
        "ORDER BY reviewed_at_server DESC",
        "LIMIT $3",
      ].join(" "),
      [workspaceId, cardId, limit],
    );

  return result.rows.map(mapReviewHistoryItem);
}

export async function summarizeDeckState(workspaceId: string): Promise<DeckSummary> {
  const result = await query<DeckSummaryRow>(
    [
      "SELECT",
      "COUNT(*)::int AS total_cards,",
      "COUNT(*) FILTER (WHERE due_at IS NULL OR due_at <= now())::int AS due_cards,",
      "COUNT(*) FILTER (WHERE reps = 0 AND lapses = 0)::int AS new_cards,",
      "COUNT(*) FILTER (WHERE reps > 0 OR lapses > 0)::int AS reviewed_cards,",
      "COALESCE(SUM(reps), 0)::int AS total_reps,",
      "COALESCE(SUM(lapses), 0)::int AS total_lapses",
      "FROM content.cards",
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Deck summary query did not return a row");
  }

  return mapDeckSummary(row);
}
