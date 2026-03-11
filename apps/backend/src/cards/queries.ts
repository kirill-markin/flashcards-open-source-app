import { query, transaction, type SqlValue } from "../db";
import { HttpError } from "../errors";
import {
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  type CursorPageInput,
} from "../pagination";
import {
  buildTokenizedAndLikeClause,
  MAX_SEARCH_TOKEN_COUNT,
  tokenizeSearchText,
} from "../searchTokens";
import type { SearchTokenClauseFactory } from "../searchTokens";
import { validateOrResetCardRowForRead } from "./fsrs";
import {
  CARD_COLUMNS,
  CARD_SELECT,
  mapCard,
  mapDeckSummary,
  mapReviewHistoryItem,
  toDate,
  toIsoString,
  toNumber,
} from "./shared";
import type {
  Card,
  CardListPage,
  CardQuerySort,
  CardQuerySortDirection,
  CardQuerySortKey,
  CardRow,
  DeckSummary,
  DeckSummaryRow,
  QueryCardsInput,
  QueryCardsPage,
  ReviewHistoryItem,
  ReviewHistoryPage,
  ReviewHistoryRow,
} from "./types";

const defaultCardsQueryPageSize = 50;
const maximumCardsQueryPageSize = 100;
const maximumCardsQuerySortCount = 3;
const cardSearchExpressionFactories: ReadonlyArray<SearchTokenClauseFactory> = [
  (paramIndex) => `lower(front_text || ' ' || back_text) LIKE $${paramIndex}`,
  (paramIndex) => `EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE lower(tag) LIKE $${paramIndex})`,
  (paramIndex) => `lower(effort_level) LIKE $${paramIndex}`,
];

type CursorValue = string | number | null;

type QueryCardsRow = CardRow & Readonly<{
  sort_front_text: string;
  sort_back_text: string;
  sort_tags: string;
  sort_effort_level: string;
  sort_due_at: Date | string | null;
  sort_reps: number;
  sort_lapses: number;
  sort_updated_at: Date | string;
  sort_card_id: string;
}>;

type QueryCardsCountRow = Readonly<{
  total_count: string | number;
}>;

type InternalSortField = Readonly<{
  key: CardQuerySortKey | "cardId";
  column: string;
  nullable: boolean;
}>;

type InternalSort = Readonly<{
  key: CardQuerySortKey | "cardId";
  direction: CardQuerySortDirection;
  column: string;
  nullable: boolean;
}>;

type DecodedCursor = Readonly<{
  values: ReadonlyArray<CursorValue>;
}>;

const sortFieldByKey: Readonly<Record<CardQuerySortKey | "cardId", InternalSortField>> = {
  frontText: {
    key: "frontText",
    column: "sort_front_text",
    nullable: false,
  },
  backText: {
    key: "backText",
    column: "sort_back_text",
    nullable: false,
  },
  tags: {
    key: "tags",
    column: "sort_tags",
    nullable: false,
  },
  effortLevel: {
    key: "effortLevel",
    column: "sort_effort_level",
    nullable: false,
  },
  dueAt: {
    key: "dueAt",
    column: "sort_due_at",
    nullable: true,
  },
  reps: {
    key: "reps",
    column: "sort_reps",
    nullable: false,
  },
  lapses: {
    key: "lapses",
    column: "sort_lapses",
    nullable: false,
  },
  updatedAt: {
    key: "updatedAt",
    column: "sort_updated_at",
    nullable: false,
  },
  cardId: {
    key: "cardId",
    column: "sort_card_id",
    nullable: false,
  },
};

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

function createCardQueryError(message: string): HttpError {
  return new HttpError(400, message);
}

function encodeCardsQueryCursor(values: ReadonlyArray<CursorValue>): string {
  return Buffer.from(JSON.stringify({ values }), "utf8").toString("base64url");
}

function decodeCardsQueryCursor(cursor: string): DecodedCursor {
  try {
    const decodedValue = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof decodedValue !== "object" || decodedValue === null || Array.isArray(decodedValue)) {
      throw new Error("Cursor payload must be an object");
    }

    const recordValue = decodedValue as Record<string, unknown>;
    if (!Array.isArray(recordValue.values)) {
      throw new Error("Cursor values must be an array");
    }

    const values = recordValue.values.map((value) => {
      if (typeof value === "string" || typeof value === "number" || value === null) {
        return value;
      }

      throw new Error("Cursor values must contain only strings, numbers, or null");
    });

    return { values };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw createCardQueryError(`cursor is invalid: ${errorMessage}`);
  }
}

type DueCardsPageCursor = Readonly<{
  dueAt: string | null;
  updatedAt: string;
  cardId: string;
}>;

type ReviewHistoryPageCursor = Readonly<{
  reviewedAtServer: string;
  reviewEventId: string;
}>;

type ReviewHistoryPageRow = ReviewHistoryRow & Readonly<{
  reviewed_at_server: Date | string;
}>;

function decodeDueCardsPageCursor(cursor: string): DueCardsPageCursor {
  const decodedCursor = decodeOpaqueCursor(cursor, "cursor");
  if (decodedCursor.values.length !== 3) {
    throw createCardQueryError("cursor does not match the requested due-cards order");
  }

  const dueAt = decodedCursor.values[0];
  const updatedAt = decodedCursor.values[1];
  const cardId = decodedCursor.values[2];
  if ((typeof dueAt !== "string" && dueAt !== null) || typeof updatedAt !== "string" || typeof cardId !== "string") {
    throw createCardQueryError("cursor does not match the requested due-cards order");
  }

  return {
    dueAt,
    updatedAt,
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

function normalizeCardsQueryLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumCardsQueryPageSize) {
    throw createCardQueryError(
      `limit must be an integer between 1 and ${maximumCardsQueryPageSize}`,
    );
  }

  return limit;
}

function normalizeCardsQuerySearchTokens(searchText: string | null): ReadonlyArray<string> | null {
  if (searchText === null) {
    return null;
  }

  const searchTokens = tokenizeSearchText(searchText, MAX_SEARCH_TOKEN_COUNT);
  if (searchTokens.length === 0) {
    throw createCardQueryError("searchText must not be empty");
  }

  return searchTokens;
}

function normalizeCardsQuerySorts(sorts: ReadonlyArray<CardQuerySort>): ReadonlyArray<CardQuerySort> {
  if (sorts.length > maximumCardsQuerySortCount) {
    throw createCardQueryError(`sorts must contain at most ${maximumCardsQuerySortCount} items`);
  }

  const uniqueKeys = new Set<CardQuerySortKey>();
  for (const sort of sorts) {
    if (uniqueKeys.has(sort.key)) {
      throw createCardQueryError(`sorts must not contain duplicate keys: ${sort.key}`);
    }

    uniqueKeys.add(sort.key);
  }

  return [...sorts];
}

function buildEffectiveCardsQuerySorts(sorts: ReadonlyArray<CardQuerySort>): ReadonlyArray<InternalSort> {
  const effectiveSorts: Array<InternalSort> = sorts.map((sort) => ({
    key: sort.key,
    direction: sort.direction,
    column: sortFieldByKey[sort.key].column,
    nullable: sortFieldByKey[sort.key].nullable,
  }));

  if (!sorts.some((sort) => sort.key === "updatedAt")) {
    effectiveSorts.push({
      key: "updatedAt",
      direction: "desc",
      column: sortFieldByKey.updatedAt.column,
      nullable: false,
    });
  }

  effectiveSorts.push({
    key: "cardId",
    direction: "asc",
    column: sortFieldByKey.cardId.column,
    nullable: false,
  });

  return effectiveSorts;
}

function buildCardsQueryOrderByClause(sorts: ReadonlyArray<InternalSort>): string {
  return sorts.map((sort) => {
    if (sort.key === "dueAt") {
      return `${sort.column} ${sort.direction.toUpperCase()} ${sort.direction === "asc" ? "NULLS FIRST" : "NULLS LAST"}`;
    }

    return `${sort.column} ${sort.direction.toUpperCase()}`;
  }).join(", ");
}

function buildCursorComparisonClause(
  sort: InternalSort,
  paramIndex: number,
  cursorValue: CursorValue,
): string {
  if (sort.nullable === false) {
    return `${sort.column} ${sort.direction === "asc" ? ">" : "<"} $${paramIndex}`;
  }

  if (sort.direction === "asc") {
    if (cursorValue === null) {
      return `${sort.column} IS NOT NULL`;
    }

    return `${sort.column} > $${paramIndex}`;
  }

  if (cursorValue === null) {
    return "FALSE";
  }

  return `(${sort.column} < $${paramIndex} OR ${sort.column} IS NULL)`;
}

function buildCardsQueryCursorWhereClause(
  effectiveSorts: ReadonlyArray<InternalSort>,
  cursor: DecodedCursor | null,
  startIndex: number,
): Readonly<{
  clause: string;
  params: ReadonlyArray<SqlValue>;
}> {
  if (cursor === null) {
    return {
      clause: "",
      params: [],
    };
  }

  if (cursor.values.length !== effectiveSorts.length) {
    throw createCardQueryError("cursor does not match the requested sort order");
  }

  const params: Array<SqlValue> = [];
  const equalityConditions: Array<string> = [];
  const comparisonGroups: Array<string> = [];

  for (const [index, sort] of effectiveSorts.entries()) {
    const cursorValue = cursor.values[index];
    const paramIndex = startIndex + params.length + 1;
    params.push(cursorValue);

    comparisonGroups.push(
      [...equalityConditions, buildCursorComparisonClause(sort, paramIndex, cursorValue)].join(" AND "),
    );
    equalityConditions.push(`${sort.column} IS NOT DISTINCT FROM $${paramIndex}`);
  }

  return {
    clause: `(${comparisonGroups.join(" OR ")})`,
    params,
  };
}

function buildCardsQuerySearchClause(
  searchTokens: ReadonlyArray<string> | null,
  startIndex: number,
): Readonly<{
  clause: string;
  params: ReadonlyArray<SqlValue>;
}> {
  if (searchTokens === null) {
    return {
      clause: "",
      params: [],
    };
  }

  const tokenizedSearchClause = buildTokenizedAndLikeClause(
    searchTokens,
    startIndex,
    cardSearchExpressionFactories,
  );

  return {
    clause: `AND (${tokenizedSearchClause.clause})`,
    params: tokenizedSearchClause.params,
  };
}

function makeCursorValueFromRow(row: QueryCardsRow, sort: InternalSort): CursorValue {
  switch (sort.key) {
  case "frontText":
    return row.sort_front_text;
  case "backText":
    return row.sort_back_text;
  case "tags":
    return row.sort_tags;
  case "effortLevel":
    return row.sort_effort_level;
  case "dueAt":
    return row.sort_due_at === null ? null : toIsoString(row.sort_due_at);
  case "reps":
    return row.sort_reps;
  case "lapses":
    return row.sort_lapses;
  case "updatedAt":
    return toIsoString(row.sort_updated_at);
  case "cardId":
    return row.sort_card_id;
  }
}

export function getCardsQueryDefaultPageSize(): number {
  return defaultCardsQueryPageSize;
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

export async function queryCardsPage(
  workspaceId: string,
  input: QueryCardsInput,
): Promise<QueryCardsPage> {
  const normalizedSearchTokens = normalizeCardsQuerySearchTokens(input.searchText);
  const normalizedLimit = normalizeCardsQueryLimit(input.limit);
  const normalizedSorts = normalizeCardsQuerySorts(input.sorts);
  const effectiveSorts = buildEffectiveCardsQuerySorts(normalizedSorts);
  const decodedCursor = input.cursor === null ? null : decodeCardsQueryCursor(input.cursor);

  return transaction(async (executor) => {
    const searchClauseResult = buildCardsQuerySearchClause(normalizedSearchTokens, 1);
    const countResult = await executor.query<QueryCardsCountRow>(
      [
        "SELECT COUNT(*)::int AS total_count",
        "FROM content.cards",
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        searchClauseResult.clause,
      ].join(" "),
      [workspaceId, ...searchClauseResult.params],
    );

    const cursorClauseResult = buildCardsQueryCursorWhereClause(
      effectiveSorts,
      decodedCursor,
      1 + searchClauseResult.params.length,
    );
    const limitParamIndex = 1 + searchClauseResult.params.length + cursorClauseResult.params.length + 1;

    const pageResult = await executor.query<QueryCardsRow>(
      [
        "WITH filtered_cards AS (",
        "SELECT",
        CARD_COLUMNS,
        ", lower(front_text) AS sort_front_text,",
        "lower(back_text) AS sort_back_text,",
        "lower(array_to_string(tags, ', ')) AS sort_tags,",
        "effort_level AS sort_effort_level,",
        "due_at AS sort_due_at,",
        "reps AS sort_reps,",
        "lapses AS sort_lapses,",
        "updated_at AS sort_updated_at,",
        "card_id AS sort_card_id",
        "FROM content.cards",
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        searchClauseResult.clause,
        ")",
        "SELECT *",
        "FROM filtered_cards",
        cursorClauseResult.clause === "" ? "" : `WHERE ${cursorClauseResult.clause}`,
        `ORDER BY ${buildCardsQueryOrderByClause(effectiveSorts)}`,
        `LIMIT $${limitParamIndex}`,
      ].join(" "),
      [
        workspaceId,
        ...searchClauseResult.params,
        ...cursorClauseResult.params,
        normalizedLimit + 1,
      ],
    );

    const hasMore = pageResult.rows.length > normalizedLimit;
    const rowsForPage = hasMore ? pageResult.rows.slice(0, normalizedLimit) : pageResult.rows;
    const repairedRows = await validateOrResetCardRowsForRead(executor, workspaceId, rowsForPage);
    const nextCursor = hasMore
      ? encodeCardsQueryCursor(
        effectiveSorts.map((sort) => makeCursorValueFromRow(pageResult.rows[normalizedLimit - 1], sort)),
      )
      : null;

    return {
      cards: repairedRows.map(mapCard),
      nextCursor,
      totalCount: toNumber(countResult.rows[0]?.total_count ?? 0),
    };
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

export async function getCards(
  workspaceId: string,
  cardIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<Card>> {
  return transaction(async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1 AND card_id = ANY($2::uuid[]) AND deleted_at IS NULL",
      ].join(" "),
      [workspaceId, cardIds],
    );

    const repairedRows = await validateOrResetCardRowsForRead(executor, workspaceId, result.rows);
    const cardsById = new Map(repairedRows.map((row) => {
      const card = mapCard(row);
      return [card.cardId, card] as const;
    }));

    return cardIds.map((cardId) => {
      const card = cardsById.get(cardId);
      if (card === undefined) {
        throw new HttpError(404, `Card not found: ${cardId}`);
      }

      return card;
    });
  });
}

/**
 * Materializes the full repaired due-card order for internal callers that must
 * reason about the exact post-repair queue as one collection.
 *
 * Keep this helper because `listReviewQueuePage()` currently derives stable
 * cursor pagination from the repaired in-memory due order, which depends on
 * FSRS repair, null due dates, and `compareCardsForReviewQueue`. API-facing
 * reads should call `listReviewQueuePage()` instead.
 */
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

export async function listReviewQueuePage(
  workspaceId: string,
  input: CursorPageInput,
): Promise<CardListPage> {
  const normalizedLimit = normalizeCardsQueryLimit(input.limit);
  const decodedCursor = input.cursor === null ? null : decodeDueCardsPageCursor(input.cursor);
  const dueCards = await listReviewQueue(workspaceId, Number.MAX_SAFE_INTEGER);
  const startIndex = decodedCursor === null
    ? 0
    : dueCards.findIndex((card) => (
      card.dueAt === decodedCursor.dueAt
      && card.updatedAt === decodedCursor.updatedAt
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
      visibleCards[visibleCards.length - 1]?.updatedAt ?? "",
      visibleCards[visibleCards.length - 1]?.cardId ?? "",
    ]);

  return {
    cards: visibleCards,
    nextCursor,
  };
}

export async function searchCards(
  workspaceId: string,
  searchText: string,
  limit: number,
): Promise<ReadonlyArray<Card>> {
  const searchTokens = tokenizeSearchText(searchText, MAX_SEARCH_TOKEN_COUNT);
  if (searchTokens.length === 0) {
    throw createCardQueryError("query must not be empty");
  }

  const searchClauseResult = buildCardsQuerySearchClause(searchTokens, 1);
  const limitParamIndex = 1 + searchClauseResult.params.length + 1;

  return transaction(async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        searchClauseResult.clause,
        "ORDER BY updated_at DESC",
        `LIMIT $${limitParamIndex}`,
      ].join(" "),
      [workspaceId, ...searchClauseResult.params, limit],
    );

    const repairedRows = await validateOrResetCardRowsForRead(executor, workspaceId, result.rows);
    return repairedRows.map(mapCard);
  });
}

export async function listReviewHistoryPage(
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

  const result = await query<ReviewHistoryPageRow>(
    [
      "SELECT review_event_id, workspace_id, device_id, client_event_id, card_id, rating, reviewed_at_client, reviewed_at_server",
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
