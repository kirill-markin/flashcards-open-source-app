import type { Card, ReviewHistoryItem } from "../cards";
import type { Deck } from "../decks";
import { HttpError } from "../errors";
import type {
  ParsedSqlStatement,
  SqlResourceName,
  SqlRow,
} from "./sqlDialect";
import { MAX_SQL_RECORD_LIMIT } from "./sqlToolLimits";

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
 * - `apps/backend/src/aiTools/sqlToolLimits.ts`
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
    effort_level: card.effortLevel,
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
    effort_levels: deck.filterDefinition.effortLevels,
    created_at: deck.createdAt,
    updated_at: deck.updatedAt,
    deleted_at: deck.deletedAt,
  };
}

export function toReviewEventRow(item: ReviewHistoryItem): SqlRow {
  return {
    review_event_id: item.reviewEventId,
    card_id: item.cardId,
    device_id: item.deviceId,
    client_event_id: item.clientEventId,
    rating: item.rating,
    reviewed_at_client: item.reviewedAtClient,
    reviewed_at_server: item.reviewedAtServer,
  };
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
  effortLevel: "fast" | "medium" | "long";
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

  if (effortLevel !== "fast" && effortLevel !== "medium" && effortLevel !== "long") {
    throw new HttpError(400, "effort_level must be fast, medium, or long", "QUERY_INVALID_SQL");
  }

  return {
    frontText,
    backText,
    tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : [],
    effortLevel,
  };
}

export function buildCreateDeckInput(
  columnNames: ReadonlyArray<string>,
  row: ReadonlyArray<AgentSqlMutationAssignmentValue>,
): Readonly<{
  name: string;
  effortLevels: ReadonlyArray<"fast" | "medium" | "long">;
  tags: ReadonlyArray<string>;
}> {
  const values = new Map(columnNames.map((columnName, index) => [columnName, row[index]] as const));
  const name = values.get("name");
  const tags = values.get("tags");
  const effortLevels = values.get("effort_levels");

  if (typeof name !== "string") {
    throw new HttpError(400, "name is required for INSERT INTO decks", "QUERY_INVALID_SQL");
  }

  return {
    name,
    effortLevels: Array.isArray(effortLevels)
      ? effortLevels.filter((item): item is "fast" | "medium" | "long" => item === "fast" || item === "medium" || item === "long")
      : [],
    tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : [],
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

export function buildCardUpdateInput(
  cardId: string,
  assignments: ReadonlyArray<AgentSqlMutationAssignment>,
): Readonly<{
  cardId: string;
  frontText: string | null;
  backText: string | null;
  tags: ReadonlyArray<string> | null;
  effortLevel: "fast" | "medium" | "long" | null;
}> {
  let frontText: string | null = null;
  let backText: string | null = null;
  let tags: ReadonlyArray<string> | null = null;
  let effortLevel: "fast" | "medium" | "long" | null = null;

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
      if (assignment.value !== "fast" && assignment.value !== "medium" && assignment.value !== "long") {
        throw new HttpError(400, "effort_level must be fast, medium, or long", "QUERY_INVALID_SQL");
      }
      effortLevel = assignment.value;
    }
  }

  return {
    cardId,
    frontText,
    backText,
    tags,
    effortLevel,
  };
}

export function buildDeckUpdateInput(
  deckId: string,
  assignments: ReadonlyArray<AgentSqlMutationAssignment>,
): Readonly<{
  deckId: string;
  name: string | null;
  effortLevels: ReadonlyArray<"fast" | "medium" | "long"> | null;
  tags: ReadonlyArray<string> | null;
}> {
  let name: string | null = null;
  let effortLevels: ReadonlyArray<"fast" | "medium" | "long"> | null = null;
  let tags: ReadonlyArray<string> | null = null;

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
      effortLevels = assignment.value.filter((item): item is "fast" | "medium" | "long" => item === "fast" || item === "medium" || item === "long");
    }

    if (assignment.columnName === "tags") {
      if (Array.isArray(assignment.value) === false) {
        throw new HttpError(400, "tags must be a string array", "QUERY_INVALID_SQL");
      }
      tags = assignment.value.filter((item): item is string => typeof item === "string");
    }
  }

  return {
    deckId,
    name,
    effortLevels,
    tags,
  };
}

export function buildReadInstructions(statementType: "show_tables" | "describe" | "select", hasMore: boolean): string {
  if (statementType === "show_tables" || statementType === "describe") {
    return "Read rows from data.rows. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the full contract.";
  }

  const paginationHint = hasMore
    ? "Repeat the same query with a larger OFFSET to continue pagination."
    : "No further rows are available for this query.";

  return `${paginationHint} LIMIT defaults to 100 and is capped at 100. SELECT returns at most 100 rows per statement. Prefer a stable ORDER BY clause when paginating. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the full contract.`;
}

export function buildMutationInstructions(): string {
  return "The mutation succeeded. Read data.affectedCount for the summary. INSERT, UPDATE, and DELETE may affect at most 100 rows per statement. If you need the resulting rows, inspect data.rows or run a follow-up SELECT query. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the full contract.";
}

export function buildBatchReadInstructions(): string {
  return "Read rows from data.statements. Each entry preserves the single-statement payload shape. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the full contract.";
}

export function buildBatchMutationInstructions(): string {
  return "The batch mutation succeeded. Read data.statements for per-statement results and data.affectedCountTotal for the summary. INSERT, UPDATE, and DELETE may affect at most 100 rows per statement. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the full contract.";
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
