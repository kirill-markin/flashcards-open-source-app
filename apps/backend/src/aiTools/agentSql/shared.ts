import type { Card, ReviewHistoryItem } from "../../cards";
import { appendLegacyEffortTag } from "../../cards/shared";
import type { Deck } from "../../decks";
import { HttpError } from "../../shared/errors";
import type { LegacyEffortLevel } from "../../sync/contracts/legacyEffort";
import { isLegacyEffortLevel } from "../../sync/contracts/legacyEffort";
import type {
  ParsedSqlStatement,
  SqlResourceName,
  SqlRow,
} from "../sqlDialect";
import { MAX_SQL_RECORD_LIMIT } from "../toolContract/sqlToolLimits";

export type AgentSqlContext = Readonly<{
  userId: string;
  workspaceId: string;
  selectedWorkspaceId: string | null;
  connectionId: string;
}>;

export type AgentSqlReadPayload = Readonly<{
  statementType: "show_tables" | "describe" | "select";
  resource: SqlResourceName | null;
  sql: string;
  normalizedSql: string;
  rows: ReadonlyArray<SqlRow>;
  rowCount: number;
  limit: number | null;
  offset: number | null;
  hasMore: boolean;
}>;

export type AgentSqlMutationPayload = Readonly<{
  statementType: "insert" | "update" | "delete";
  resource: "cards" | "decks";
  sql: string;
  normalizedSql: string;
  rows: ReadonlyArray<SqlRow>;
  affectedCount: number;
}>;

export type AgentSqlSinglePayload = AgentSqlReadPayload | AgentSqlMutationPayload;

export type AgentSqlBatchPayload = Readonly<{
  statementType: "batch";
  resource: null;
  sql: string;
  normalizedSql: string;
  statements: ReadonlyArray<AgentSqlSinglePayload>;
  statementCount: number;
  affectedCountTotal: number | null;
}>;

export type AgentSqlPayload = AgentSqlSinglePayload | AgentSqlBatchPayload;

export type AgentSqlReadExecutionResult = Readonly<{
  data: AgentSqlReadPayload;
  instructions: string;
}>;

export type AgentSqlMutationExecutionResult = Readonly<{
  data: AgentSqlMutationPayload;
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

export function toCreatedCardRows(cards: ReadonlyArray<Card>): ReadonlyArray<SqlRow> {
  return cards.map(toCardRow);
}

export function toCreatedDeckRows(decks: ReadonlyArray<Deck>): ReadonlyArray<SqlRow> {
  return decks.map(toDeckRow);
}

export function buildCreateCardInput(
  columnNames: ReadonlyArray<string>,
  row: ReadonlyArray<AgentSqlMutationAssignmentValue>,
): Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
}> {
  const values = new Map(columnNames.map((columnName, index) => [columnName, row[index]] as const));
  const frontText = values.get("front_text");
  const backText = values.get("back_text");
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

  return {
    frontText,
    backText,
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
  tags: ReadonlyArray<string> | null;
}> {
  const cardId = row.card_id;
  if (typeof cardId !== "string") {
    throw new HttpError(400, "Expected card_id to be present", "QUERY_INVALID_SQL");
  }

  let frontText: string | null = null;
  let backText: string | null = null;
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
    return "Read rows from data.rows. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the published external agent contract.";
  }

  const paginationHint = hasMore
    ? "Repeat the same query with a larger OFFSET to continue pagination."
    : "No further rows are available for this query.";

  return `${paginationHint} LIMIT defaults to 100 and is capped at 100. SELECT returns at most 100 rows per statement. Prefer a stable ORDER BY clause when paginating. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the published external agent contract.`;
}

export function buildMutationInstructions(): string {
  return "The mutation succeeded. Read data.affectedCount for the summary. INSERT, UPDATE, and DELETE may affect at most 100 rows per statement. If you need the resulting rows, inspect data.rows or run a follow-up SELECT query. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the published external agent contract.";
}

export function buildBatchReadInstructions(): string {
  return "Read rows from data.statements. Each entry preserves the single-statement payload shape. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the published external agent contract.";
}

export function buildBatchMutationInstructions(): string {
  return "The batch mutation succeeded. Read data.statements for per-statement results and data.affectedCountTotal for the summary. INSERT, UPDATE, and DELETE may affect at most 100 rows per statement. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the published external agent contract.";
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
