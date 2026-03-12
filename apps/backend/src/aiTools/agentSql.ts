import { HttpError } from "../errors";
import type { Card, ReviewHistoryItem } from "../cards";
import type { Deck } from "../decks";
import {
  DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
  createAgentCardsOperation,
  createAgentDecksOperation,
  deleteAgentCardsOperation,
  deleteAgentDecksOperation,
  getAgentSchedulerSettingsOperation,
  listAgentCardsOperation,
  listAgentDecksOperation,
  listAgentDueCardsOperation,
  listAgentReviewHistoryOperation,
  listAgentTagsOperation,
  loadAgentWorkspaceContextOperation,
  updateAgentCardsOperation,
  updateAgentDecksOperation,
  type AgentToolOperationDependencies,
} from "./agentToolOperations";
import {
  getSqlResourceDescriptors,
  parseSqlStatement,
  type ParsedSqlStatement,
  type SqlColumnDescriptor,
  type SqlPredicate,
  type SqlResourceDescriptor,
  type SqlResourceName,
  type SqlSelectOrderBy,
} from "./sqlDialect";

type SqlRowScalar = string | number | boolean | null;
type SqlRowValue = SqlRowScalar | ReadonlyArray<string> | ReadonlyArray<number>;

export type SqlRow = Readonly<Record<string, SqlRowValue>>;

type AgentSqlContext = Readonly<{
  userId: string;
  workspaceId: string;
  selectedWorkspaceId: string | null;
  connectionId: string;
}>;

type AgentSqlReadPayload = Readonly<{
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

type AgentSqlMutationPayload = Readonly<{
  statementType: "insert" | "update" | "delete";
  resource: "cards" | "decks";
  sql: string;
  normalizedSql: string;
  rows: ReadonlyArray<SqlRow>;
  affectedCount: number;
}>;

export type AgentSqlPayload = AgentSqlReadPayload | AgentSqlMutationPayload;

export type AgentSqlExecutionResult = Readonly<{
  data: AgentSqlPayload;
  instructions: string;
}>;

const MAX_SQL_LIMIT = 100;

const SQL_RESOURCE_DESCRIPTOR_MAP = Object.freeze(
  Object.fromEntries(getSqlResourceDescriptors().map((descriptor) => [descriptor.resourceName, descriptor] as const)),
) as Readonly<Record<SqlResourceName, SqlResourceDescriptor>>;

function getSqlResourceDescriptor(resourceName: SqlResourceName): SqlResourceDescriptor {
  return SQL_RESOURCE_DESCRIPTOR_MAP[resourceName];
}

function getSqlColumnDescriptor(resourceName: SqlResourceName, columnName: string): SqlColumnDescriptor {
  const columnDescriptor = getSqlResourceDescriptor(resourceName).columns.find((column) => column.columnName === columnName);
  if (columnDescriptor === undefined) {
    throw new HttpError(400, `Unknown column for ${resourceName}: ${columnName}`, "QUERY_INVALID_SQL");
  }

  return columnDescriptor;
}

function normalizeSqlLimit(limit: number | null): number {
  if (limit === null) {
    return MAX_SQL_LIMIT;
  }

  if (limit < 1) {
    throw new HttpError(400, "LIMIT must be greater than 0", "QUERY_INVALID_SQL");
  }

  return Math.min(limit, MAX_SQL_LIMIT);
}

function normalizeSqlOffset(offset: number | null): number {
  if (offset === null) {
    return 0;
  }

  if (offset < 0) {
    throw new HttpError(400, "OFFSET must be a non-negative integer", "QUERY_INVALID_SQL");
  }

  return offset;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function likePatternToRegExp(value: string): RegExp {
  const escaped = escapeRegExp(value).replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function normalizeSearchableText(value: SqlRowValue): string {
  if (Array.isArray(value)) {
    return value.join(" ").toLowerCase();
  }

  if (value === null) {
    return "";
  }

  return String(value).toLowerCase();
}

function compareRowValues(left: SqlRowValue | undefined, right: SqlRowValue | undefined): number {
  if (left === undefined && right === undefined) {
    return 0;
  }

  if (left === undefined || left === null) {
    return right === undefined || right === null ? 0 : -1;
  }

  if (right === undefined || right === null) {
    return 1;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    const leftText = Array.isArray(left) ? left.join("\u0000") : String(left);
    const rightText = Array.isArray(right) ? right.join("\u0000") : String(right);
    return leftText.localeCompare(rightText);
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return String(left).localeCompare(String(right));
}

function valuesEqual(left: SqlRowValue | undefined, right: string | number | boolean | null): boolean {
  if (left === undefined) {
    return false;
  }

  if (Array.isArray(left)) {
    return false;
  }

  return left === right;
}

function normalizeStringArray(value: SqlRowValue | undefined): ReadonlyArray<string> {
  if (value === undefined || value === null || Array.isArray(value) === false) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function validatePredicate(resourceName: SqlResourceName, predicate: SqlPredicate): void {
  if (predicate.type === "match") {
    return;
  }

  const columnDescriptor = getSqlColumnDescriptor(resourceName, predicate.columnName);
  if (columnDescriptor.filterable === false) {
    throw new HttpError(
      400,
      `Column is not filterable: ${predicate.columnName}`,
      "QUERY_UNSUPPORTED_SYNTAX",
    );
  }
}

function rowMatchesPredicate(row: SqlRow, predicate: SqlPredicate): boolean {
  if (predicate.type === "match") {
    const normalizedQuery = predicate.query.trim().toLowerCase();
    if (normalizedQuery === "") {
      throw new HttpError(400, "MATCH query must not be empty", "QUERY_INVALID_SQL");
    }

    return Object.values(row).some((value) => normalizeSearchableText(value).includes(normalizedQuery));
  }

  const columnValue = row[predicate.columnName];
  if (predicate.type === "comparison") {
    return valuesEqual(columnValue, predicate.value);
  }

  if (predicate.type === "in") {
    return predicate.values.some((value) => valuesEqual(columnValue, value));
  }

  if (predicate.type === "is_null") {
    return columnValue === null;
  }

  return normalizeStringArray(columnValue).some((value) => predicate.values.includes(value));
}

function applyPredicates(
  resourceName: SqlResourceName,
  rows: ReadonlyArray<SqlRow>,
  predicates: ReadonlyArray<SqlPredicate>,
): ReadonlyArray<SqlRow> {
  for (const predicate of predicates) {
    validatePredicate(resourceName, predicate);
  }

  if (predicates.length === 0) {
    return rows;
  }

  return rows.filter((row) => predicates.every((predicate) => rowMatchesPredicate(row, predicate)));
}

function applyOrderBy(
  rows: ReadonlyArray<SqlRow>,
  orderBy: ReadonlyArray<SqlSelectOrderBy>,
): ReadonlyArray<SqlRow> {
  if (orderBy.length === 0) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    for (const item of orderBy) {
      const comparison = compareRowValues(left[item.columnName], right[item.columnName]);
      if (comparison !== 0) {
        return item.direction === "desc" ? -comparison : comparison;
      }
    }

    return 0;
  });
}

function paginateRows(
  rows: ReadonlyArray<SqlRow>,
  limit: number,
  offset: number,
): Readonly<{
  rows: ReadonlyArray<SqlRow>;
  hasMore: boolean;
}> {
  const pagedRows = rows.slice(offset, offset + limit);
  return {
    rows: pagedRows,
    hasMore: offset + pagedRows.length < rows.length,
  };
}

function toCardRow(card: Card): SqlRow {
  return {
    card_id: card.cardId,
    front_text: card.frontText,
    back_text: card.backText,
    tags: card.tags,
    effort_level: card.effortLevel,
    due_at: card.dueAt,
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

function toDeckRow(deck: Deck): SqlRow {
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

function toReviewHistoryRow(item: ReviewHistoryItem): SqlRow {
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

function toCreatedCardsRows(cards: ReadonlyArray<Card>): ReadonlyArray<SqlRow> {
  return cards.map(toCardRow);
}

function toCreatedDeckRows(decks: ReadonlyArray<Deck>): ReadonlyArray<SqlRow> {
  return decks.map(toDeckRow);
}

async function collectCardRows(
  dependencies: AgentToolOperationDependencies,
  workspaceId: string,
): Promise<ReadonlyArray<SqlRow>> {
  const rows: Array<SqlRow> = [];
  let cursor: string | null = null;

  do {
    const page = await listAgentCardsOperation(dependencies, {
      workspaceId,
      cursor,
      limit: MAX_SQL_LIMIT,
      filter: null,
    });
    rows.push(...page.cards.map(toCardRow));
    cursor = page.nextCursor;
  } while (cursor !== null);

  return rows;
}

async function collectDueCardRows(
  dependencies: AgentToolOperationDependencies,
  workspaceId: string,
): Promise<ReadonlyArray<SqlRow>> {
  const rows: Array<SqlRow> = [];
  let cursor: string | null = null;

  do {
    const page = await listAgentDueCardsOperation(dependencies, {
      workspaceId,
      cursor,
      limit: MAX_SQL_LIMIT,
    });
    rows.push(...page.cards.map(toCardRow));
    cursor = page.nextCursor;
  } while (cursor !== null);

  return rows;
}

async function collectDeckRows(
  dependencies: AgentToolOperationDependencies,
  workspaceId: string,
): Promise<ReadonlyArray<SqlRow>> {
  const rows: Array<SqlRow> = [];
  let cursor: string | null = null;

  do {
    const page = await listAgentDecksOperation(dependencies, {
      workspaceId,
      cursor,
      limit: MAX_SQL_LIMIT,
    });
    rows.push(...page.decks.map(toDeckRow));
    cursor = page.nextCursor;
  } while (cursor !== null);

  return rows;
}

async function collectReviewHistoryRows(
  dependencies: AgentToolOperationDependencies,
  workspaceId: string,
): Promise<ReadonlyArray<SqlRow>> {
  const rows: Array<SqlRow> = [];
  let cursor: string | null = null;

  do {
    const page = await listAgentReviewHistoryOperation(dependencies, {
      workspaceId,
      cursor,
      limit: MAX_SQL_LIMIT,
      cardId: null,
    });
    rows.push(...page.history.map(toReviewHistoryRow));
    cursor = page.nextCursor;
  } while (cursor !== null);

  return rows;
}

async function loadSelectRows(
  dependencies: AgentToolOperationDependencies,
  context: AgentSqlContext,
  resourceName: SqlResourceName,
): Promise<ReadonlyArray<SqlRow>> {
  if (resourceName === "workspace_context") {
    const payload = await loadAgentWorkspaceContextOperation(dependencies, {
      userId: context.userId,
      workspaceId: context.workspaceId,
      selectedWorkspaceId: context.selectedWorkspaceId,
    });
    return [{
      workspace_id: payload.workspace.workspaceId,
      workspace_name: payload.workspace.name,
      total_cards: payload.deckSummary.totalCards,
      due_cards: payload.deckSummary.dueCards,
      new_cards: payload.deckSummary.newCards,
      reviewed_cards: payload.deckSummary.reviewedCards,
    }];
  }

  if (resourceName === "scheduler_settings") {
    const payload = await getAgentSchedulerSettingsOperation(dependencies, {
      workspaceId: context.workspaceId,
    });
    return [{
      algorithm: payload.schedulerSettings.algorithm,
      desired_retention: payload.schedulerSettings.desiredRetention,
      learning_steps_minutes: payload.schedulerSettings.learningStepsMinutes,
      relearning_steps_minutes: payload.schedulerSettings.relearningStepsMinutes,
      maximum_interval_days: payload.schedulerSettings.maximumIntervalDays,
      enable_fuzz: payload.schedulerSettings.enableFuzz,
    }];
  }

  if (resourceName === "tags_summary") {
    const payload = await listAgentTagsOperation(dependencies, {
      workspaceId: context.workspaceId,
    });
    return payload.tags.map((tag) => ({
      tag: tag.tag,
      cards_count: tag.cardsCount,
      total_cards: payload.totalCards,
    }));
  }

  if (resourceName === "cards") {
    return collectCardRows(dependencies, context.workspaceId);
  }

  if (resourceName === "due_cards") {
    return collectDueCardRows(dependencies, context.workspaceId);
  }

  if (resourceName === "decks") {
    return collectDeckRows(dependencies, context.workspaceId);
  }

  return collectReviewHistoryRows(dependencies, context.workspaceId);
}

function buildCreateCardInput(
  columnNames: ReadonlyArray<string>,
  row: ReadonlyArray<string | number | boolean | null | ReadonlyArray<string>>,
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

function buildCreateDeckInput(
  columnNames: ReadonlyArray<string>,
  row: ReadonlyArray<string | number | boolean | null | ReadonlyArray<string>>,
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

  const normalizedEffortLevels = Array.isArray(effortLevels)
    ? effortLevels.filter((item): item is "fast" | "medium" | "long" => item === "fast" || item === "medium" || item === "long")
    : [];

  return {
    name,
    effortLevels: normalizedEffortLevels,
    tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : [],
  };
}

function requireSqlMutationTargetIds(resourceName: "cards" | "decks", rows: ReadonlyArray<SqlRow>): ReadonlyArray<string> {
  const idColumnName = resourceName === "cards" ? "card_id" : "deck_id";
  return rows.map((row) => {
    const idValue = row[idColumnName];
    if (typeof idValue !== "string") {
      throw new HttpError(400, `Expected ${idColumnName} to be present`, "QUERY_INVALID_SQL");
    }

    return idValue;
  });
}

function buildCardUpdateInput(
  cardId: string,
  assignments: ReadonlyArray<Readonly<{ columnName: string; value: string | number | boolean | null | ReadonlyArray<string> }>>,
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

function buildDeckUpdateInput(
  deckId: string,
  assignments: ReadonlyArray<Readonly<{ columnName: string; value: string | number | boolean | null | ReadonlyArray<string> }>>,
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

function buildReadInstructions(statementType: "show_tables" | "describe" | "select", hasMore: boolean): string {
  if (statementType === "show_tables" || statementType === "describe") {
    return "Read rows from data.rows. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the full contract.";
  }

  const paginationHint = hasMore
    ? "Repeat the same query with a larger OFFSET to continue pagination."
    : "No further rows are available for this query.";

  return `${paginationHint} LIMIT defaults to 100 and is capped at 100. Prefer a stable ORDER BY clause when paginating. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the full contract.`;
}

function buildMutationInstructions(): string {
  return "The mutation succeeded. Read data.affectedCount for the summary. If you need the resulting rows, inspect data.rows or run a follow-up SELECT query. This endpoint supports the published SQL dialect, not full PostgreSQL. Use docs.openapiUrl for the full contract.";
}

async function executeSqlReadStatement(
  dependencies: AgentToolOperationDependencies,
  context: AgentSqlContext,
  sql: string,
  statement: Extract<ParsedSqlStatement, Readonly<{ type: "show_tables" | "describe" | "select" }>>,
): Promise<AgentSqlExecutionResult> {
  if (statement.type === "show_tables") {
    const rows = getSqlResourceDescriptors()
      .filter((descriptor) => statement.likePattern === null || likePatternToRegExp(statement.likePattern).test(descriptor.resourceName))
      .map((descriptor) => ({
        table_name: descriptor.resourceName,
        writable: descriptor.writable,
        description: descriptor.description,
      }));

    return {
      data: {
        statementType: "show_tables",
        resource: null,
        sql,
        normalizedSql: statement.normalizedSql,
        rows,
        rowCount: rows.length,
        limit: null,
        offset: null,
        hasMore: false,
      },
      instructions: buildReadInstructions("show_tables", false),
    };
  }

  if (statement.type === "describe") {
    const rows = getSqlResourceDescriptor(statement.resourceName).columns.map((column) => ({
      column_name: column.columnName,
      type: column.type,
      nullable: column.nullable,
      read_only: column.readOnly,
      filterable: column.filterable,
      sortable: column.sortable,
      description: column.description,
    }));

    return {
      data: {
        statementType: "describe",
        resource: statement.resourceName,
        sql,
        normalizedSql: statement.normalizedSql,
        rows,
        rowCount: rows.length,
        limit: null,
        offset: null,
        hasMore: false,
      },
      instructions: buildReadInstructions("describe", false),
    };
  }

  const limit = normalizeSqlLimit(statement.limit);
  const offset = normalizeSqlOffset(statement.offset);
  const rows = await loadSelectRows(dependencies, context, statement.resourceName);
  const filteredRows = applyPredicates(statement.resourceName, rows, statement.predicates);
  const orderedRows = applyOrderBy(filteredRows, statement.orderBy);
  const paginatedRows = paginateRows(orderedRows, limit, offset);

  return {
    data: {
      statementType: "select",
      resource: statement.resourceName,
      sql,
      normalizedSql: statement.normalizedSql,
      rows: paginatedRows.rows,
      rowCount: paginatedRows.rows.length,
      limit,
      offset,
      hasMore: paginatedRows.hasMore,
    },
    instructions: buildReadInstructions("select", paginatedRows.hasMore),
  };
}

async function executeSqlMutationStatement(
  dependencies: AgentToolOperationDependencies,
  context: AgentSqlContext,
  sql: string,
  statement: Extract<ParsedSqlStatement, Readonly<{ type: "insert" | "update" | "delete" }>>,
): Promise<AgentSqlExecutionResult> {
  if (statement.type === "insert" && statement.resourceName === "cards") {
    const payload = await createAgentCardsOperation(dependencies, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      connectionId: context.connectionId,
      actionName: "create_cards",
      cards: statement.rows.map((row) => buildCreateCardInput(statement.columnNames, row)),
    });
    return {
      data: {
        statementType: "insert",
        resource: "cards",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: toCreatedCardsRows(payload.cards),
        affectedCount: payload.createdCount,
      },
      instructions: buildMutationInstructions(),
    };
  }

  if (statement.type === "insert" && statement.resourceName === "decks") {
    const payload = await createAgentDecksOperation(dependencies, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      connectionId: context.connectionId,
      actionName: "create_decks",
      decks: statement.rows.map((row) => buildCreateDeckInput(statement.columnNames, row)),
    });
    return {
      data: {
        statementType: "insert",
        resource: "decks",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: toCreatedDeckRows(payload.decks),
        affectedCount: payload.createdCount,
      },
      instructions: buildMutationInstructions(),
    };
  }

  if (statement.type !== "update" && statement.type !== "delete") {
    throw new HttpError(400, "Unsupported SQL mutation", "QUERY_UNSUPPORTED_SYNTAX");
  }

  const currentRows = await loadSelectRows(dependencies, context, statement.resourceName);
  const matchedRows = applyPredicates(statement.resourceName, currentRows, statement.predicates);
  const targetIds = requireSqlMutationTargetIds(statement.resourceName, matchedRows);

  if (statement.type === "update" && statement.resourceName === "cards") {
    const payload = await updateAgentCardsOperation(dependencies, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      connectionId: context.connectionId,
      actionName: "update_cards",
      updates: targetIds.map((cardId) => buildCardUpdateInput(cardId, statement.assignments)),
    });
    return {
      data: {
        statementType: "update",
        resource: "cards",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: toCreatedCardsRows(payload.cards),
        affectedCount: payload.updatedCount,
      },
      instructions: buildMutationInstructions(),
    };
  }

  if (statement.type === "update" && statement.resourceName === "decks") {
    const payload = await updateAgentDecksOperation(dependencies, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      connectionId: context.connectionId,
      actionName: "update_decks",
      updates: targetIds.map((deckId) => buildDeckUpdateInput(deckId, statement.assignments)),
    });
    return {
      data: {
        statementType: "update",
        resource: "decks",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: toCreatedDeckRows(payload.decks),
        affectedCount: payload.updatedCount,
      },
      instructions: buildMutationInstructions(),
    };
  }

  if (statement.type === "delete" && statement.resourceName === "cards") {
    const payload = await deleteAgentCardsOperation(dependencies, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      connectionId: context.connectionId,
      actionName: "delete_cards",
      cardIds: targetIds,
    });
    return {
      data: {
        statementType: "delete",
        resource: "cards",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: [],
        affectedCount: payload.deletedCount,
      },
      instructions: buildMutationInstructions(),
    };
  }

  if (statement.type === "delete" && statement.resourceName === "decks") {
    const payload = await deleteAgentDecksOperation(dependencies, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      connectionId: context.connectionId,
      actionName: "delete_decks",
      deckIds: targetIds,
    });
    return {
      data: {
        statementType: "delete",
        resource: "decks",
        sql,
        normalizedSql: statement.normalizedSql,
        rows: [],
        affectedCount: payload.deletedCount,
      },
      instructions: buildMutationInstructions(),
    };
  }

  throw new HttpError(400, "Unsupported SQL mutation", "QUERY_UNSUPPORTED_SYNTAX");
}

export async function executeAgentSql(
  context: AgentSqlContext,
  sql: string,
  dependencies: AgentToolOperationDependencies = DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
): Promise<AgentSqlExecutionResult> {
  let statement: ParsedSqlStatement;

  try {
    statement = parseSqlStatement(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, message, "QUERY_INVALID_SQL", {
      validationIssues: [{
        path: "sql",
        code: "invalid_sql",
        message,
      }],
    });
  }

  if (statement.type === "show_tables" || statement.type === "describe" || statement.type === "select") {
    return executeSqlReadStatement(dependencies, context, sql, statement);
  }

  return executeSqlMutationStatement(dependencies, context, sql, statement);
}
