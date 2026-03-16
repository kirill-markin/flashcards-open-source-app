import {
  parseSqlStatement,
  splitSqlStatements,
  type ParsedSqlStatement,
} from "../../../backend/src/aiTools/sqlDialect";
import {
  MAX_SQL_BATCH_STATEMENT_COUNT,
  type LocalSqlExecutionResult,
  type SqlSingleExecutionPayload,
  type WebLocalToolExecutorDependencies,
} from "./localToolExecutorTypes";
import type { WorkspaceSummary } from "../types";
import { executeLocalSqlMutationBatch, executeLocalSqlMutationStatement } from "./localToolExecutorSqlMutation";
import { executeLocalSqlReadStatement } from "./localToolExecutorSqlRead";

type LocalReadStatement = Extract<
  ParsedSqlStatement,
  Readonly<{ type: "show_tables" | "describe" | "select" }>
>;

type LocalMutationStatement = Extract<
  ParsedSqlStatement,
  Readonly<{ type: "insert" | "update" | "delete" }>
>;

function isReadStatement(statement: ParsedSqlStatement): statement is LocalReadStatement {
  return statement.type === "show_tables" || statement.type === "describe" || statement.type === "select";
}

function isMutationStatement(statement: ParsedSqlStatement): statement is LocalMutationStatement {
  return statement.type === "insert" || statement.type === "update" || statement.type === "delete";
}

function makeBatchNormalizedSql(statements: ReadonlyArray<ParsedSqlStatement>): string {
  return statements.map((statement) => statement.normalizedSql).join("; ");
}

async function executeParsedSqlStatement(
  dependencies: WebLocalToolExecutorDependencies,
  activeWorkspace: WorkspaceSummary,
  sql: string,
  statement: ParsedSqlStatement,
): Promise<LocalSqlExecutionResult> {
  if (isReadStatement(statement)) {
    return executeLocalSqlReadStatement(activeWorkspace, sql, statement);
  }

  if (isMutationStatement(statement)) {
    return executeLocalSqlMutationStatement(dependencies, activeWorkspace, sql, statement);
  }

  throw new Error("Unsupported SQL statement");
}

export async function executeSqlBatchLocally(
  dependencies: WebLocalToolExecutorDependencies,
  activeWorkspace: WorkspaceSummary,
  sql: string,
): Promise<LocalSqlExecutionResult> {
  const statementSqls = splitSqlStatements(sql);
  if (statementSqls.length === 0) {
    throw new Error("sql must not be empty");
  }

  if (statementSqls.length === 1) {
    return executeParsedSqlStatement(
      dependencies,
      activeWorkspace,
      sql,
      parseSqlStatement(sql),
    );
  }

  if (statementSqls.length > MAX_SQL_BATCH_STATEMENT_COUNT) {
    throw new Error(`SQL batch must contain at most ${MAX_SQL_BATCH_STATEMENT_COUNT} statements`);
  }

  const statements = statementSqls.map((statementSql) => parseSqlStatement(statementSql));
  const normalizedSql = makeBatchNormalizedSql(statements);
  const allReadStatements = statements.every((statement) => isReadStatement(statement));
  const allMutationStatements = statements.every((statement) => isMutationStatement(statement));

  if (allReadStatements === false && allMutationStatements === false) {
    throw new Error("SQL batch must contain only read statements or only mutation statements");
  }

  if (allReadStatements) {
    const payloads: Array<SqlSingleExecutionPayload> = [];

    for (const [index, statement] of statements.entries()) {
      const result = await executeLocalSqlReadStatement(
        activeWorkspace,
        statementSqls[index] ?? statement.normalizedSql,
        statement,
      );
      payloads.push(result.payload as SqlSingleExecutionPayload);
    }

    return {
      payload: {
        statementType: "batch",
        resource: null,
        sql,
        normalizedSql,
        statements: payloads,
        statementCount: payloads.length,
        affectedCountTotal: null,
      },
      didMutateAppState: false,
    };
  }

  return executeLocalSqlMutationBatch(
    dependencies,
    activeWorkspace,
    sql,
    statements,
    statementSqls,
    normalizedSql,
  );
}
