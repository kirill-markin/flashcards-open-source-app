import {
  createAgentCardsOperation,
  createAgentDecksOperation,
  deleteAgentCardsOperation,
  deleteAgentDecksOperation,
  updateAgentCardsOperation,
  updateAgentDecksOperation,
  type AgentToolOperationDependencies,
} from "./agentToolOperations";
import { executeSqlSelect, type SqlRow } from "./sqlDialect";
import {
  assertSqlMutationRecordLimit,
  buildCardUpdateInput,
  buildCreateCardInput,
  buildCreateDeckInput,
  buildDeckUpdateInput,
  buildMutationInstructions,
  requireSqlMutationTargetIds,
  toCreatedCardRows,
  toCreatedDeckRows,
  type AgentSqlContext,
  type AgentSqlMutationExecutionResult,
  type AgentSqlMutationStatement,
} from "./agentSqlShared";
import { loadSelectRows } from "./agentSqlReadExecution";
import { HttpError } from "../errors";

function selectTargetRows(
  statement: Extract<AgentSqlMutationStatement, Readonly<{ type: "update" | "delete" }>>,
  rows: ReadonlyArray<SqlRow>,
): ReadonlyArray<SqlRow> {
  return executeSqlSelect({
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
    limit: 100,
    offset: 0,
    normalizedSql: statement.normalizedSql,
  }, rows, Number.MAX_SAFE_INTEGER).rows;
}

export async function executeSqlMutationStatement(
  dependencies: AgentToolOperationDependencies,
  context: AgentSqlContext,
  sql: string,
  statement: AgentSqlMutationStatement,
): Promise<AgentSqlMutationExecutionResult> {
  if (statement.type === "insert" && statement.resourceName === "cards") {
    assertSqlMutationRecordLimit("insert", statement.rows.length);
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
    assertSqlMutationRecordLimit("insert", statement.rows.length);
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
  const matchedRows = selectTargetRows(statement, currentRows);
  const targetIds = requireSqlMutationTargetIds(statement.resourceName, matchedRows);
  assertSqlMutationRecordLimit(statement.type, targetIds.length);

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
