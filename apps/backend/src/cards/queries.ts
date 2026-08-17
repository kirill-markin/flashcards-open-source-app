import {
  queryWithWorkspaceScopeReadOnly,
  transactionWithWorkspaceScopeReadOnly,
  type DatabaseExecutor,
  type SqlValue,
} from "../database";
import { HttpError } from "../shared/errors";
import {
  buildTokenizedAndLikeClause,
  MAX_SEARCH_TOKEN_COUNT,
  tokenizeSearchText,
} from "../search/tokens";
import type { SearchTokenClauseFactory } from "../search/tokens";
import { normalizeCardFilter } from "./filters";
import {
  createCardQueryError,
  normalizeCardsQueryLimit,
} from "./querySupport";
import {
  CARD_COLUMNS,
  CARD_SELECT,
  mapCard,
  mapDeckSummary,
  toIsoString,
  toNumber,
} from "./shared";
import type {
  Card,
  CardFilter,
  CardQuerySort,
  CardQuerySortDirection,
  CardQuerySortKey,
  CardRow,
  DeckSummary,
  DeckSummaryRow,
  QueryCardsInput,
  QueryCardsPage,
  WorkspaceTagSummary,
  WorkspaceTagsSummary,
} from "./types";

const defaultCardsQueryPageSize = 50;
const maximumCardsQuerySortCount = 3;
const cardSearchExpressionFactories: ReadonlyArray<SearchTokenClauseFactory> = [
  (paramIndex) => `lower(front_text || ' ' || back_text) LIKE $${paramIndex}`,
  (paramIndex) => `EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE lower(tag) LIKE $${paramIndex})`,
];

type CursorValue = string | number | null;

type QueryCardsRow = CardRow & Readonly<{
  sort_front_text: string;
  sort_back_text: string;
  sort_tags: string;
  sort_due_at: Date | string | null;
  sort_created_at: Date | string;
  sort_reps: number;
  sort_lapses: number;
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
  createdAt: {
    key: "createdAt",
    column: "sort_created_at",
    nullable: false,
  },
  cardId: {
    key: "cardId",
    column: "sort_card_id",
    nullable: false,
  },
};

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

  if (!sorts.some((sort) => sort.key === "createdAt")) {
    effectiveSorts.push({
      key: "createdAt",
      direction: "desc",
      column: sortFieldByKey.createdAt.column,
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

export function buildCardsQueryFilterClause(
  filter: CardFilter | null,
  startIndex: number,
): Readonly<{
  clause: string;
  params: ReadonlyArray<SqlValue>;
}> {
  if (filter === null) {
    return {
      clause: "",
      params: [],
    };
  }

  const clauses: Array<string> = [];
  const params: Array<SqlValue> = [];

  if (filter.tags.length > 0) {
    params.push(filter.tags);
    clauses.push(`tags && $${startIndex + params.length}::text[]`);
  }

  if (clauses.length === 0) {
    return {
      clause: "",
      params: [],
    };
  }

  return {
    clause: `AND ${clauses.join(" AND ")}`,
    params,
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
  case "dueAt":
    return row.sort_due_at === null ? null : toIsoString(row.sort_due_at);
  case "reps":
    return row.sort_reps;
  case "lapses":
    return row.sort_lapses;
  case "createdAt":
    return toIsoString(row.sort_created_at);
  case "cardId":
    return row.sort_card_id;
  }
}

export function getCardsQueryDefaultPageSize(): number {
  return defaultCardsQueryPageSize;
}

export async function listCardsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<ReadonlyArray<Card>> {
  const result = await executor.query<CardRow>(
    [
      CARD_SELECT,
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
      "ORDER BY created_at DESC, card_id ASC",
    ].join(" "),
    [workspaceId],
  );

  return result.rows.map(mapCard);
}

export async function listCards(userId: string, workspaceId: string): Promise<ReadonlyArray<Card>> {
  return transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => {
    return listCardsInExecutor(executor, workspaceId);
  });
}

export async function queryCardsPage(
  userId: string,
  workspaceId: string,
  input: QueryCardsInput,
): Promise<QueryCardsPage> {
  const normalizedSearchTokens = normalizeCardsQuerySearchTokens(input.searchText);
  const normalizedLimit = normalizeCardsQueryLimit(input.limit);
  const normalizedSorts = normalizeCardsQuerySorts(input.sorts);
  const normalizedFilter = normalizeCardFilter(input.filter);
  const effectiveSorts = buildEffectiveCardsQuerySorts(normalizedSorts);
  const decodedCursor = input.cursor === null ? null : decodeCardsQueryCursor(input.cursor);

  return transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => {
    const filterClauseResult = buildCardsQueryFilterClause(normalizedFilter, 1);
    const searchClauseResult = buildCardsQuerySearchClause(
      normalizedSearchTokens,
      1 + filterClauseResult.params.length,
    );
    const countResult = await executor.query<QueryCardsCountRow>(
      [
        "SELECT COUNT(*)::int AS total_count",
        "FROM content.cards",
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        filterClauseResult.clause,
        searchClauseResult.clause,
      ].join(" "),
      [workspaceId, ...filterClauseResult.params, ...searchClauseResult.params],
    );

    const cursorClauseResult = buildCardsQueryCursorWhereClause(
      effectiveSorts,
      decodedCursor,
      1 + filterClauseResult.params.length + searchClauseResult.params.length,
    );
    const limitParamIndex = 2 + filterClauseResult.params.length + searchClauseResult.params.length + cursorClauseResult.params.length;

    const pageResult = await executor.query<QueryCardsRow>(
      [
        "WITH filtered_cards AS (",
        "SELECT",
        CARD_COLUMNS,
        ", lower(front_text) AS sort_front_text,",
        "lower(back_text) AS sort_back_text,",
        "lower(array_to_string(tags, ', ')) AS sort_tags,",
        "due_at AS sort_due_at,",
        "created_at AS sort_created_at,",
        "reps AS sort_reps,",
        "lapses AS sort_lapses,",
        "card_id AS sort_card_id",
        "FROM content.cards",
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        filterClauseResult.clause,
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
        ...filterClauseResult.params,
        ...searchClauseResult.params,
        ...cursorClauseResult.params,
        normalizedLimit + 1,
      ],
    );

    const hasMore = pageResult.rows.length > normalizedLimit;
    const rowsForPage = hasMore ? pageResult.rows.slice(0, normalizedLimit) : pageResult.rows;
    const nextCursor = hasMore
      ? encodeCardsQueryCursor(
        effectiveSorts.map((sort) => makeCursorValueFromRow(pageResult.rows[normalizedLimit - 1], sort)),
      )
      : null;

    return {
      cards: rowsForPage.map(mapCard),
      nextCursor,
      totalCount: toNumber(countResult.rows[0]?.total_count ?? 0),
    };
  });
}

export async function getCard(userId: string, workspaceId: string, cardId: string): Promise<Card> {
  return transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => {
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

    return mapCard(row);
  });
}

export async function getCards(
  userId: string,
  workspaceId: string,
  cardIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<Card>> {
  return transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1 AND card_id = ANY($2::uuid[]) AND deleted_at IS NULL",
      ].join(" "),
      [workspaceId, cardIds],
    );

    const cardsById = new Map(result.rows.map((row) => {
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

export async function searchCards(
  userId: string,
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

  return transactionWithWorkspaceScopeReadOnly({ userId, workspaceId }, async (executor) => {
    const result = await executor.query<CardRow>(
      [
        CARD_SELECT,
        "WHERE workspace_id = $1",
        "AND deleted_at IS NULL",
        searchClauseResult.clause,
        "ORDER BY created_at DESC, card_id ASC",
        `LIMIT $${limitParamIndex}`,
      ].join(" "),
      [workspaceId, ...searchClauseResult.params, limit],
    );

    return result.rows.map(mapCard);
  });
}

export async function summarizeDeckState(userId: string, workspaceId: string): Promise<DeckSummary> {
  const result = await queryWithWorkspaceScopeReadOnly<DeckSummaryRow>(
    { userId, workspaceId },
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

export async function listWorkspaceTagsSummary(userId: string, workspaceId: string): Promise<WorkspaceTagsSummary> {
  const totalCardsResult = await queryWithWorkspaceScopeReadOnly<Readonly<{ total_cards: string | number }>>(
    { userId, workspaceId },
    [
      "SELECT COUNT(*)::int AS total_cards",
      "FROM content.cards",
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
    ].join(" "),
    [workspaceId],
  );
  const totalCardsRow = totalCardsResult.rows[0];
  if (totalCardsRow === undefined) {
    throw new Error("Workspace tag summary count query did not return a row");
  }

  const tagRowsResult = await queryWithWorkspaceScopeReadOnly<Readonly<{ tag: string; cards_count: string | number }>>(
    { userId, workspaceId },
    [
      "SELECT tag_counts.tag, tag_counts.cards_count",
      "FROM (",
      "SELECT tag, COUNT(*)::int AS cards_count",
      "FROM content.cards cards",
      "CROSS JOIN LATERAL unnest(cards.tags) AS tag",
      "WHERE cards.workspace_id = $1 AND cards.deleted_at IS NULL",
      "GROUP BY tag",
      ") AS tag_counts",
      "ORDER BY tag_counts.cards_count DESC, lower(tag_counts.tag) ASC, tag_counts.tag ASC",
    ].join(" "),
    [workspaceId],
  );

  const tags: ReadonlyArray<WorkspaceTagSummary> = tagRowsResult.rows.map((row) => ({
    tag: row.tag,
    cardsCount: toNumber(row.cards_count),
  }));

  return {
    tags,
    totalCards: toNumber(totalCardsRow.total_cards),
  };
}
