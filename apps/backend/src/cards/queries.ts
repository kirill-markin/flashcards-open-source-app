import { query, transaction, type SqlValue } from "../db";
import { HttpError } from "../errors";
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
  CardQuerySort,
  CardQuerySortDirection,
  CardQuerySortKey,
  CardRow,
  DeckSummary,
  DeckSummaryRow,
  QueryCardsInput,
  QueryCardsPage,
  ReviewHistoryItem,
  ReviewHistoryRow,
} from "./types";

const defaultCardsQueryPageSize = 50;
const maximumCardsQueryPageSize = 100;
const maximumCardsQuerySortCount = 3;

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

function normalizeCardsQueryLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumCardsQueryPageSize) {
    throw createCardQueryError(
      `limit must be an integer between 1 and ${maximumCardsQueryPageSize}`,
    );
  }

  return limit;
}

function normalizeCardsQuerySearchText(searchText: string | null): string | null {
  if (searchText === null) {
    return null;
  }

  const normalizedSearchText = searchText.trim();
  if (normalizedSearchText === "") {
    throw createCardQueryError("searchText must not be empty");
  }

  return normalizedSearchText;
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
  searchText: string | null,
  startIndex: number,
): Readonly<{
  clause: string;
  params: ReadonlyArray<SqlValue>;
}> {
  if (searchText === null) {
    return {
      clause: "",
      params: [],
    };
  }

  return {
    clause: [
      "AND lower(concat_ws(' ', front_text, back_text, array_to_string(tags, ' ')))",
      `LIKE $${startIndex + 1}`,
    ].join(" "),
    params: [`%${searchText.toLowerCase()}%`],
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
  const normalizedSearchText = normalizeCardsQuerySearchText(input.searchText);
  const normalizedLimit = normalizeCardsQueryLimit(input.limit);
  const normalizedSorts = normalizeCardsQuerySorts(input.sorts);
  const effectiveSorts = buildEffectiveCardsQuerySorts(normalizedSorts);
  const decodedCursor = input.cursor === null ? null : decodeCardsQueryCursor(input.cursor);

  return transaction(async (executor) => {
    const searchClauseResult = buildCardsQuerySearchClause(normalizedSearchText, 1);
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
      hasMore,
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
        "WHERE workspace_id = $1 AND card_id = ANY($2::text[]) AND deleted_at IS NULL",
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
