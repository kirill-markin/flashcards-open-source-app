import { HttpError } from "../errors";
import {
  DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
  type AgentToolOperationDependencies,
} from "./agentToolOperations";
import {
  parseSqlStatement,
  splitSqlStatements,
  type ParsedSqlStatement,
} from "./sqlDialect";
import { executeSqlMutationBatch } from "./agentSqlBatchMutation";
import { executeSqlReadBatch, executeSqlReadStatement } from "./agentSqlReadExecution";
import {
  isSqlMutationStatement,
  isSqlReadStatement,
  type AgentSqlContext,
} from "./agentSqlShared";
import { executeSqlMutationStatement } from "./agentSqlSingleMutation";
import { MAX_SQL_BATCH_STATEMENT_COUNT } from "./sqlToolLimits";

export type {
  AgentSqlExecutionResult,
  AgentSqlPayload,
} from "./agentSqlShared";

function buildInvalidSqlError(message: string): HttpError {
  return new HttpError(400, message, "QUERY_INVALID_SQL", {
    validationIssues: [{
      path: "sql",
      code: "invalid_sql",
      message,
    }],
  });
}

function parseSingleStatementSql(sql: string): ParsedSqlStatement {
  try {
    return parseSqlStatement(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw buildInvalidSqlError(message);
  }
}

function splitStatementSqls(sql: string): ReadonlyArray<string> {
  try {
    return splitSqlStatements(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw buildInvalidSqlError(message);
  }
}

function parseBatchStatements(statementSqls: ReadonlyArray<string>): ReadonlyArray<ParsedSqlStatement> {
  return statementSqls.map((statementSql, index) => {
    try {
      return parseSqlStatement(statementSql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw buildInvalidSqlError(`SQL batch statement ${index + 1} failed: ${message}`);
    }
  });
}

export async function executeAgentSql(
  context: AgentSqlContext,
  sql: string,
  dependencies: AgentToolOperationDependencies = DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
) {
  const statementSqls = splitStatementSqls(sql);

  if (statementSqls.length === 0) {
    throw buildInvalidSqlError("sql must not be empty");
  }

  if (statementSqls.length === 1) {
    const statement = parseSingleStatementSql(sql);

    if (isSqlReadStatement(statement)) {
      return executeSqlReadStatement(dependencies, context, sql, statement);
    }

    return executeSqlMutationStatement(dependencies, context, sql, statement);
  }

  if (statementSqls.length > MAX_SQL_BATCH_STATEMENT_COUNT) {
    throw buildInvalidSqlError(`SQL batch must contain at most ${MAX_SQL_BATCH_STATEMENT_COUNT} statements`);
  }

  const statements = parseBatchStatements(statementSqls);

  if (statements.every(isSqlReadStatement)) {
    return executeSqlReadBatch(
      dependencies,
      context,
      sql,
      statements,
      statementSqls,
    );
  }

  if (statements.every(isSqlMutationStatement)) {
    return executeSqlMutationBatch(
      dependencies,
      context,
      sql,
      statements,
      statementSqls,
    );
  }

  throw buildInvalidSqlError("SQL batch must contain only read statements or only mutation statements");
}
