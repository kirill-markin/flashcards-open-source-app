import { HttpError } from "../errors";
import type { Card, ReviewHistoryItem } from "../cards";
import type { Deck } from "../decks";
import {
  DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
  createAgentCardsOperation,
  createAgentDecksOperation,
  deleteAgentCardsOperation,
  deleteAgentDecksOperation,
  listAgentCardsOperation,
  listAgentDecksOperation,
  listAgentReviewEventsOperation,
  loadAgentWorkspaceOperation,
  updateAgentCardsOperation,
  updateAgentDecksOperation,
  type AgentToolOperationDependencies,
} from "./agentToolOperations";
import {
  executeSqlSelect,
  getSqlResourceDescriptor,
  getSqlResourceDescriptors,
  likePatternToRegExp,
  parseSqlStatement,
  type ParsedSqlStatement,
  type SqlResourceName,
  type SqlRow,
  type SqlRowValue,
} from "./sqlDialect";

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

function toCardRow(card: Card): SqlRow {
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

function toReviewEventRow(item: ReviewHistoryItem): SqlRow {
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

function toCreatedCardRows(cards: ReadonlyArray<Card>): ReadonlyArray<SqlRow> {
  return cards.map(toCardRow);
}

function toCreatedDeckRows(decks: ReadonlyArray<Deck>): ReadonlyArray<SqlRow> {
  return decks.map(toDeckRow);
}

async function collectCardRows(
  dependencies: AgentToolOperationDependencies,
  userId: string,
  workspaceId: string,
): Promise<ReadonlyArray<SqlRow>> {
  const rows: Array<SqlRow> = [];
  let cursor: string | null = null;

  do {
    const page = await listAgentCardsOperation(dependencies, {
      userId,
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

async function collectDeckRows(
  dependencies: AgentToolOperationDependencies,
  userId: string,
  workspaceId: string,
): Promise<ReadonlyArray<SqlRow>> {
  const rows: Array<SqlRow> = [];
  let cursor: string | null = null;

  do {
    const page = await listAgentDecksOperation(dependencies, {
      userId,
      workspaceId,
      cursor,
      limit: MAX_SQL_LIMIT,
    });
    rows.push(...page.decks.map(toDeckRow));
    cursor = page.nextCursor;
  } while (cursor !== null);

  return rows;
}

async function collectReviewEventRows(
  dependencies: AgentToolOperationDependencies,
  userId: string,
  workspaceId: string,
): Promise<ReadonlyArray<SqlRow>> {
  const rows: Array<SqlRow> = [];
  let cursor: string | null = null;

  do {
    const page = await listAgentReviewEventsOperation(dependencies, {
      userId,
      workspaceId,
      cursor,
      limit: MAX_SQL_LIMIT,
      cardId: null,
    });
    rows.push(...page.history.map(toReviewEventRow));
    cursor = page.nextCursor;
  } while (cursor !== null);

  return rows;
}

async function loadWorkspaceRows(
  dependencies: AgentToolOperationDependencies,
  context: AgentSqlContext,
): Promise<ReadonlyArray<SqlRow>> {
  const payload = await loadAgentWorkspaceOperation(dependencies, {
    userId: context.userId,
    workspaceId: context.workspaceId,
    selectedWorkspaceId: context.selectedWorkspaceId,
  });

  return [{
    workspace_id: payload.workspace.workspaceId,
    name: payload.workspace.name,
    created_at: payload.workspace.createdAt,
    algorithm: payload.schedulerSettings.algorithm,
    desired_retention: payload.schedulerSettings.desiredRetention,
    learning_steps_minutes: payload.schedulerSettings.learningStepsMinutes,
    relearning_steps_minutes: payload.schedulerSettings.relearningStepsMinutes,
    maximum_interval_days: payload.schedulerSettings.maximumIntervalDays,
    enable_fuzz: payload.schedulerSettings.enableFuzz,
  }];
}

async function loadSelectRows(
  dependencies: AgentToolOperationDependencies,
  context: AgentSqlContext,
  resourceName: SqlResourceName,
): Promise<ReadonlyArray<SqlRow>> {
  if (resourceName === "workspace") {
    return loadWorkspaceRows(dependencies, context);
  }

  if (resourceName === "cards") {
    return collectCardRows(dependencies, context.userId, context.workspaceId);
  }

  if (resourceName === "decks") {
    return collectDeckRows(dependencies, context.userId, context.workspaceId);
  }

  return collectReviewEventRows(dependencies, context.userId, context.workspaceId);
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

  return {
    name,
    effortLevels: Array.isArray(effortLevels)
      ? effortLevels.filter((item): item is "fast" | "medium" | "long" => item === "fast" || item === "medium" || item === "long")
      : [],
    tags: Array.isArray(tags) ? tags.filter((item): item is string => typeof item === "string") : [],
  };
}

function requireSqlMutationTargetIds(
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

  const rows = await loadSelectRows(dependencies, context, statement.source.resourceName);
  const result = executeSqlSelect(statement, rows, MAX_SQL_LIMIT);
  return {
    data: {
      statementType: "select",
      resource: statement.source.resourceName,
      sql,
      normalizedSql: statement.normalizedSql,
      rows: result.rows,
      rowCount: result.rowCount,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore,
    },
    instructions: buildReadInstructions("select", result.hasMore),
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
        rows: toCreatedCardRows(payload.cards),
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
  const matchedRows = executeSqlSelect({
    type: "select",
    source: {
      resourceName: statement.resourceName,
      unnestAlias: null,
      unnestColumnName: null,
    },
    selectItems: [{ type: "wildcard" }],
    predicateClauses: statement.predicateClauses,
    groupBy: [],
    orderBy: [],
    limit: MAX_SQL_LIMIT,
    offset: 0,
    normalizedSql: statement.normalizedSql,
  }, currentRows, Number.MAX_SAFE_INTEGER).rows;
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
        rows: toCreatedCardRows(payload.cards),
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
