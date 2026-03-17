import {
  listAgentCardsOperation,
  listAgentDecksOperation,
  listAgentReviewEventsOperation,
  loadAgentWorkspaceOperation,
  type AgentToolOperationDependencies,
} from "./agentToolOperations";
import {
  executeSqlSelect,
  getSqlResourceDescriptor,
  getSqlResourceDescriptors,
  likePatternToRegExp,
  type SqlResourceName,
  type SqlRow,
} from "./sqlDialect";
import {
  MAX_SQL_LIMIT,
  buildBatchReadInstructions,
  buildReadInstructions,
  makeBatchNormalizedSql,
  toCardRow,
  toDeckRow,
  toReviewEventRow,
  wrapBatchExecutionError,
  type AgentSqlContext,
  type AgentSqlExecutionResult,
  type AgentSqlReadExecutionResult,
  type AgentSqlReadStatement,
  type AgentSqlSinglePayload,
} from "./agentSqlShared";

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

export async function loadSelectRows(
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

export async function executeSqlReadStatement(
  dependencies: AgentToolOperationDependencies,
  context: AgentSqlContext,
  sql: string,
  statement: AgentSqlReadStatement,
): Promise<AgentSqlReadExecutionResult> {
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

export async function executeSqlReadBatch(
  dependencies: AgentToolOperationDependencies,
  context: AgentSqlContext,
  sql: string,
  statements: ReadonlyArray<AgentSqlReadStatement>,
  statementSqls: ReadonlyArray<string>,
): Promise<AgentSqlExecutionResult> {
  const payloads: Array<AgentSqlSinglePayload> = [];

  for (const [index, statement] of statements.entries()) {
    try {
      const result = await executeSqlReadStatement(
        dependencies,
        context,
        statementSqls[index] ?? statement.normalizedSql,
        statement,
      );
      payloads.push(result.data);
    } catch (error) {
      wrapBatchExecutionError(error, index, statementSqls[index] ?? statement.normalizedSql);
    }
  }

  return {
    data: {
      statementType: "batch",
      resource: null,
      sql,
      normalizedSql: makeBatchNormalizedSql(statements),
      statements: payloads,
      statementCount: payloads.length,
      affectedCountTotal: null,
    },
    instructions: buildBatchReadInstructions(),
  };
}
