import type { Card, ReviewHistoryItem } from "../../cards";
import { appendLegacyEffortTag } from "../../cards/shared";
import type { Deck } from "../../decks";
import { HttpError } from "../../shared/errors";
import type { LegacyEffortLevel } from "../../sync/contracts/legacyEffort";
import { isLegacyEffortLevel } from "../../sync/contracts/legacyEffort";
import type {
  ParsedSqlStatement,
  SqlResourceName,
  SqlReturningClause,
  SqlRow,
} from "../sqlDialect";
import { MAX_SQL_RECORD_LIMIT } from "../toolContract/sqlToolLimits";

/**
 * Entrypoint that executed the SQL. Kept as a closed union and required on
 * `AgentSqlContext` so a future surface cannot reach the shared executors
 * silently untagged in telemetry.
 */
export type AgentSqlSurface = "chat-tool" | "agent-rest" | "mcp";

export type AgentSqlContext = Readonly<{
  userId: string;
  workspaceId: string;
  selectedWorkspaceId: string | null;
  connectionId: string;
  surface: AgentSqlSurface;
  /**
   * Best-effort label of the foreign client behind the surface, recorded so the
   * SQL failure rate can be split per client. Only the MCP surface can observe
   * one today (see `apps/backend/src/mcp/server.ts`), so it stays optional.
   */
  caller?: string | null;
}>;

export type AgentSqlReadStatementPayload = Readonly<{
  statementType: "show_tables" | "describe" | "select";
  resource: SqlResourceName | null;
  rows: ReadonlyArray<SqlRow>;
  rowCount: number;
  limit: number | null;
  offset: number | null;
  hasMore: boolean;
}>;

/**
 * Row returned by a mutation. Without a RETURNING clause INSERT and UPDATE
 * return the server-generated identifier alone and DELETE returns nothing,
 * because echoing every column made a full 50-statement batch overflow the
 * result-size budget. A RETURNING clause replaces that with the projection the
 * caller named.
 */
export type AgentSqlMutationRow = SqlRow;

export type AgentSqlMutationStatementPayload = Readonly<{
  statementType: "insert" | "update" | "delete";
  resource: "cards" | "decks";
  rows: ReadonlyArray<AgentSqlMutationRow>;
  affectedCount: number;
}>;

/**
 * The submitted SQL, carried by the top-level payload only. Batch entries omit
 * it so a batch does not repeat the same statement text once per entry on top
 * of the two top-level fields.
 */
type AgentSqlSubmittedSql = Readonly<{
  sql: string;
  normalizedSql: string;
}>;

export type AgentSqlReadPayload = AgentSqlReadStatementPayload & AgentSqlSubmittedSql;

export type AgentSqlMutationPayload = AgentSqlMutationStatementPayload & AgentSqlSubmittedSql;

export type AgentSqlSinglePayload = AgentSqlReadStatementPayload | AgentSqlMutationStatementPayload;

export type AgentSqlBatchPayload = Readonly<{
  statementType: "batch";
  resource: null;
  sql: string;
  normalizedSql: string;
  statements: ReadonlyArray<AgentSqlSinglePayload>;
  statementCount: number;
  affectedCountTotal: number | null;
}>;

export type AgentSqlPayload = AgentSqlReadPayload | AgentSqlMutationPayload | AgentSqlBatchPayload;

export type AgentSqlReadExecutionResult = Readonly<{
  data: AgentSqlReadPayload;
  instructions: string;
}>;

export type AgentSqlMutationExecutionResult = Readonly<{
  data: AgentSqlMutationPayload;
  instructions: string;
}>;

export type AgentSqlBatchExecutionResult = Readonly<{
  data: AgentSqlBatchPayload;
  instructions: string;
}>;

export type AgentSqlExecutionResult = Readonly<{
  data: AgentSqlPayload;
  instructions: string;
}>;

/**
 * Keep this alias aligned with:
 * - `apps/backend/src/aiTools/toolContract/sqlToolLimits.ts`
 * - `apps/web/src/types.ts`
 * - `apps/ios/Flashcards/Flashcards/AI/AIChatTypes.swift`
 */
export const MAX_SQL_LIMIT = MAX_SQL_RECORD_LIMIT;

export type AgentSqlReadStatement = Extract<ParsedSqlStatement, Readonly<{ type: "show_tables" | "describe" | "select" }>>;

export type AgentSqlMutationStatement = Extract<ParsedSqlStatement, Readonly<{ type: "insert" | "update" | "delete" }>>;

export type AgentSqlMutationAssignmentValue = string | number | boolean | null | ReadonlyArray<string>;

export type AgentSqlMutationAssignment = Readonly<{
  columnName: string;
  value: AgentSqlMutationAssignmentValue;
}>;

export function toCardRow(card: Card): SqlRow {
  return {
    card_id: card.cardId,
    front_text: card.frontText,
    back_text: card.backText,
    card_type: card.cardType,
    metadata: card.metadata,
    tags: card.tags,
    due_at: card.dueAt,
    created_at: card.createdAt,
    reps: card.reps,
    lapses: card.lapses,
    updated_at: card.updatedAt,
    deleted_at: card.deletedAt,
    fsrs_card_state: card.fsrsCardState,
    fsrs_step_index: card.fsrsStepIndex,
    fsrs_stability: card.fsrsStability,
    fsrs_difficulty: card.fsrsDifficulty,
    fsrs_last_reviewed_at: card.fsrsLastReviewedAt,
    fsrs_scheduled_days: card.fsrsScheduledDays,
  };
}

export function toDeckRow(deck: Deck): SqlRow {
  return {
    deck_id: deck.deckId,
    name: deck.name,
    tags: deck.filterDefinition.tags,
    created_at: deck.createdAt,
    updated_at: deck.updatedAt,
    deleted_at: deck.deletedAt,
  };
}

export function toReviewEventRow(item: ReviewHistoryItem): SqlRow {
  return {
    review_event_id: item.reviewEventId,
    card_id: item.cardId,
    replica_id: item.replicaId,
    client_event_id: item.clientEventId,
    rating: item.rating,
    reviewed_at_client: item.reviewedAtClient,
    reviewed_at_server: item.reviewedAtServer,
  };
}

function expectLegacyEffortLevel(value: unknown, columnName: string): LegacyEffortLevel {
  if (isLegacyEffortLevel(value)) {
    return value;
  }

  throw new HttpError(400, `${columnName} must contain only fast, medium, or long`, "QUERY_INVALID_SQL");
}

function projectReturningRow(returning: SqlReturningClause, row: SqlRow): SqlRow {
  if (returning.type === "all") {
    return row;
  }

  return Object.fromEntries(
    returning.columnNames.map((columnName) => [columnName, row[columnName] ?? null] as const),
  );
}

export function toCardMutationRows(
  cards: ReadonlyArray<Card>,
  returning: SqlReturningClause | null,
): ReadonlyArray<AgentSqlMutationRow> {
  if (returning === null) {
    return cards.map((card) => ({ card_id: card.cardId }));
  }

  return cards.map((card) => projectReturningRow(returning, toCardRow(card)));
}

export function toDeckMutationRows(
  decks: ReadonlyArray<Deck>,
  returning: SqlReturningClause | null,
): ReadonlyArray<AgentSqlMutationRow> {
  if (returning === null) {
    return decks.map((deck) => ({ deck_id: deck.deckId }));
  }

  return decks.map((deck) => projectReturningRow(returning, toDeckRow(deck)));
}

/**
 * Projects the rows a DELETE removed, as they were before it ran. They are the
 * one mutation result a follow-up SELECT can never recover.
 *
 * The projection is filtered to the identifier set that `affectedCount` counts.
 */
export function toDeletedMutationRows(
  resourceName: "cards" | "decks",
  deletedIds: ReadonlyArray<string>,
  matchedRows: ReadonlyArray<SqlRow>,
  returning: SqlReturningClause | null,
): ReadonlyArray<AgentSqlMutationRow> {
  if (returning === null) {
    return [];
  }

  const idColumnName = resourceName === "cards" ? "card_id" : "deck_id";
  const deletedIdSet = new Set(deletedIds);

  return matchedRows
    .filter((row) => {
      const idValue = row[idColumnName];
      return typeof idValue === "string" && deletedIdSet.has(idValue);
    })
    .map((row) => projectReturningRow(returning, row));
}

export function buildCreateCardInput(
  columnNames: ReadonlyArray<string>,
  row: ReadonlyArray<AgentSqlMutationAssignmentValue>,
): Readonly<{
  frontText: string;
  backText: string;
  cardType?: string;
  tags: ReadonlyArray<string>;
}> {
  const values = new Map(columnNames.map((columnName, index) => [columnName, row[index]] as const));
  const frontText = values.get("front_text");
  const backText = values.get("back_text");
  const cardType = values.get("card_type");
  const tags = values.get("tags");
  const effortLevel = values.get("effort_level");

  if (typeof frontText !== "string") {
    throw new HttpError(400, "front_text is required for INSERT INTO cards", "QUERY_INVALID_SQL");
  }

  if (typeof backText !== "string") {
    throw new HttpError(400, "back_text is required for INSERT INTO cards", "QUERY_INVALID_SQL");
  }

  if (effortLevel !== undefined && isLegacyEffortLevel(effortLevel) === false) {
    throw new HttpError(400, "effort_level must be fast, medium, or long", "QUERY_INVALID_SQL");
  }

  if (cardType !== undefined && typeof cardType !== "string") {
    throw new HttpError(400, "card_type must be a string", "QUERY_INVALID_SQL");
  }

  return {
    frontText,
    backText,
    ...(cardType !== undefined ? { cardType } : {}),
    tags: appendLegacyEffortTag(
      Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : [],
      effortLevel,
    ),
  };
}

export function buildCreateDeckInput(
  columnNames: ReadonlyArray<string>,
  row: ReadonlyArray<AgentSqlMutationAssignmentValue>,
): Readonly<{
  name: string;
  tags: ReadonlyArray<string>;
}> {
  const values = new Map(columnNames.map((columnName, index) => [columnName, row[index]] as const));
  const name = values.get("name");
  const tags = values.get("tags");
  const effortLevels = values.get("effort_levels");

  if (typeof name !== "string") {
    throw new HttpError(400, "name is required for INSERT INTO decks", "QUERY_INVALID_SQL");
  }

  if (effortLevels !== undefined && Array.isArray(effortLevels) === false) {
    throw new HttpError(400, "effort_levels must be a string array", "QUERY_INVALID_SQL");
  }

  const legacyEffortTags = (Array.isArray(effortLevels) ? effortLevels : []).map(
    (item) => expectLegacyEffortLevel(item, "effort_levels"),
  ).reduce<ReadonlyArray<string>>(
    (result, item) => appendLegacyEffortTag(result, item),
    Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : [],
  );

  return {
    name,
    tags: legacyEffortTags,
  };
}

export function requireSqlMutationTargetIds(
  resourceName: "cards" | "decks",
  rows: ReadonlyArray<SqlRow>,
): ReadonlyArray<string> {
  const idColumnName = resourceName === "cards" ? "card_id" : "deck_id";
  return rows.map((row) => {
    const idValue = row[idColumnName];
    if (typeof idValue !== "string") {
      throw new HttpError(400, `Expected ${idColumnName} to be present`, "QUERY_INVALID_SQL");
    }

    return idValue;
  });
}

function getStringArrayRowValue(row: SqlRow, columnName: string): ReadonlyArray<string> {
  const value = row[columnName];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function appendLegacyEffortTags(
  tags: ReadonlyArray<string>,
  effortLevels: ReadonlyArray<LegacyEffortLevel>,
): ReadonlyArray<string> {
  return effortLevels.reduce<ReadonlyArray<string>>(
    (result, effortLevel) => appendLegacyEffortTag(result, effortLevel),
    tags,
  );
}

export function buildCardUpdateInput(
  row: SqlRow,
  assignments: ReadonlyArray<AgentSqlMutationAssignment>,
): Readonly<{
  cardId: string;
  frontText: string | null;
  backText: string | null;
  cardType: string | null;
  tags: ReadonlyArray<string> | null;
}> {
  const cardId = row.card_id;
  if (typeof cardId !== "string") {
    throw new HttpError(400, "Expected card_id to be present", "QUERY_INVALID_SQL");
  }

  let frontText: string | null = null;
  let backText: string | null = null;
  let cardType: string | null = null;
  let tags: ReadonlyArray<string> | null = null;
  let legacyEffortLevel: LegacyEffortLevel | null = null;

  for (const assignment of assignments) {
    if (assignment.columnName === "front_text") {
      if (typeof assignment.value !== "string") {
        throw new HttpError(400, "front_text must be a string", "QUERY_INVALID_SQL");
      }
      frontText = assignment.value;
    }

    if (assignment.columnName === "back_text") {
      if (typeof assignment.value !== "string") {
        throw new HttpError(400, "back_text must be a string", "QUERY_INVALID_SQL");
      }
      backText = assignment.value;
    }

    if (assignment.columnName === "card_type") {
      if (typeof assignment.value !== "string") {
        throw new HttpError(400, "card_type must be a string", "QUERY_INVALID_SQL");
      }
      cardType = assignment.value;
    }

    if (assignment.columnName === "tags") {
      if (Array.isArray(assignment.value) === false) {
        throw new HttpError(400, "tags must be a string array", "QUERY_INVALID_SQL");
      }
      tags = assignment.value.filter((item): item is string => typeof item === "string");
    }

    if (assignment.columnName === "effort_level") {
      if (isLegacyEffortLevel(assignment.value) === false) {
        throw new HttpError(400, "effort_level must be fast, medium, or long", "QUERY_INVALID_SQL");
      }
      legacyEffortLevel = assignment.value;
    }
  }

  const resolvedTags = legacyEffortLevel === null
    ? tags
    : appendLegacyEffortTag(tags ?? getStringArrayRowValue(row, "tags"), legacyEffortLevel);

  return {
    cardId,
    frontText,
    backText,
    cardType,
    tags: resolvedTags,
  };
}

export function buildDeckUpdateInput(
  row: SqlRow,
  assignments: ReadonlyArray<AgentSqlMutationAssignment>,
): Readonly<{
  deckId: string;
  name: string | null;
  tags: ReadonlyArray<string> | null;
}> {
  const deckId = row.deck_id;
  if (typeof deckId !== "string") {
    throw new HttpError(400, "Expected deck_id to be present", "QUERY_INVALID_SQL");
  }

  let name: string | null = null;
  let tags: ReadonlyArray<string> | null = null;
  let legacyEffortLevels: ReadonlyArray<LegacyEffortLevel> | null = null;

  for (const assignment of assignments) {
    if (assignment.columnName === "name") {
      if (typeof assignment.value !== "string") {
        throw new HttpError(400, "name must be a string", "QUERY_INVALID_SQL");
      }
      name = assignment.value;
    }

    if (assignment.columnName === "effort_levels") {
      if (Array.isArray(assignment.value) === false) {
        throw new HttpError(400, "effort_levels must be a string array", "QUERY_INVALID_SQL");
      }
      legacyEffortLevels = assignment.value.map((item) => expectLegacyEffortLevel(item, "effort_levels"));
    }

    if (assignment.columnName === "tags") {
      if (Array.isArray(assignment.value) === false) {
        throw new HttpError(400, "tags must be a string array", "QUERY_INVALID_SQL");
      }
      tags = assignment.value.filter((item): item is string => typeof item === "string");
    }
  }

  const resolvedTags = legacyEffortLevels === null
    ? tags
    : appendLegacyEffortTags(tags ?? getStringArrayRowValue(row, "tags"), legacyEffortLevels);

  return {
    deckId,
    name,
    tags: resolvedTags,
  };
}

export function buildReadInstructions(statementType: "show_tables" | "describe" | "select", hasMore: boolean): string {
  if (statementType === "show_tables" || statementType === "describe") {
    return "Read rows from data.rows. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.discoveryUrl for runtime routes and docs.source.agentRoutesUrl for implementation details.";
  }

  const paginationHint = hasMore
    ? "Repeat the same query with a larger OFFSET to continue pagination."
    : "No further rows are available for this query.";

  return `${paginationHint} LIMIT defaults to 100 and is capped at 100. SELECT returns at most 100 rows per statement. Prefer a stable ORDER BY clause when paginating. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.discoveryUrl for runtime routes and docs.source.agentRoutesUrl for implementation details.`;
}

export function buildMutationInstructions(): string {
  return "The mutation succeeded. Read data.affectedCount for the summary. INSERT, UPDATE, and DELETE may affect at most 100 rows per statement. Without a RETURNING clause, INSERT and UPDATE return only the identifier column in data.rows and DELETE returns no rows. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.discoveryUrl for runtime routes and docs.source.agentRoutesUrl for implementation details.";
}

export function buildBatchReadInstructions(): string {
  return "Read rows from data.statements. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.discoveryUrl for runtime routes and docs.source.agentRoutesUrl for implementation details.";
}

export function buildBatchMutationInstructions(): string {
  return "The batch mutation succeeded. Read data.statements for per-statement results and data.affectedCountTotal for the summary. INSERT, UPDATE, and DELETE may affect at most 100 rows per statement. Without a RETURNING clause, INSERT and UPDATE return only the identifier column in each entry's rows and DELETE returns no rows. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.discoveryUrl for runtime routes and docs.source.agentRoutesUrl for implementation details.";
}

export function assertSqlMutationRecordLimit(
  statementType: "insert" | "update" | "delete",
  count: number,
): void {
  if (count > MAX_SQL_LIMIT) {
    throw new HttpError(
      400,
      `${statementType.toUpperCase()} may affect at most ${MAX_SQL_LIMIT} records per statement`,
      "QUERY_INVALID_SQL",
    );
  }
}

export function isSqlReadStatement(
  statement: ParsedSqlStatement,
): statement is AgentSqlReadStatement {
  return statement.type === "show_tables" || statement.type === "describe" || statement.type === "select";
}

export function isSqlMutationStatement(
  statement: ParsedSqlStatement,
): statement is AgentSqlMutationStatement {
  return statement.type === "insert" || statement.type === "update" || statement.type === "delete";
}

export function makeBatchNormalizedSql(statements: ReadonlyArray<ParsedSqlStatement>): string {
  return statements.map((statement) => statement.normalizedSql).join("; ");
}

export function previewSqlStatement(sql: string): string {
  return sql.length <= 120 ? sql : `${sql.slice(0, 117)}...`;
}

export function wrapBatchExecutionError(error: unknown, statementIndex: number, sql: string): never {
  const message = error instanceof Error ? error.message : String(error);
  const prefixedMessage = `SQL batch statement ${statementIndex + 1} failed: ${message}. Statement: ${previewSqlStatement(sql)}`;

  if (error instanceof HttpError) {
    throw new HttpError(error.statusCode, prefixedMessage, error.code ?? undefined, error.details ?? undefined);
  }

  throw new Error(prefixedMessage);
}
