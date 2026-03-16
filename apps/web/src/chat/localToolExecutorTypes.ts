import type { AppDataContextValue } from "../appData/types";
import type {
  SqlResourceName,
  SqlRow,
} from "../../../backend/src/aiTools/sqlDialect";
import {
  MAX_SQL_BATCH_STATEMENT_COUNT as BACKEND_MAX_SQL_BATCH_STATEMENT_COUNT,
  MAX_SQL_RECORD_LIMIT as BACKEND_MAX_SQL_RECORD_LIMIT,
} from "../../../backend/src/aiTools/sqlToolLimits";

export type LocalToolExecutionResult = Readonly<{
  output: string;
  didMutateAppState: boolean;
}>;

export type LocalToolCallRequest = Readonly<{
  toolCallId: string;
  name: string;
  input: string;
}>;

export type AIOutboxEntryPayload = Readonly<{
  operationId: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  action: string;
  clientUpdatedAt: string;
  createdAt: string;
  attemptCount: number;
  lastError: string;
  payloadSummary: string;
}>;

export type LocalOutboxPagePayload = Readonly<{
  outbox: ReadonlyArray<AIOutboxEntryPayload>;
  nextCursor: string | null;
}>;

export type WebLocalToolExecutorDependencies = Pick<
  AppDataContextValue,
  | "session"
  | "activeWorkspace"
  | "refreshLocalData"
  | "createCardItem"
  | "createDeckItem"
  | "updateCardItem"
  | "updateDeckItem"
  | "deleteCardItem"
  | "deleteDeckItem"
>;

export type SqlSingleExecutionPayload =
  | Readonly<{
    statementType: "show_tables" | "describe" | "select";
    resource: SqlResourceName | null;
    sql: string;
    normalizedSql: string;
    rows: ReadonlyArray<SqlRow>;
    rowCount: number;
    limit: number | null;
    offset: number | null;
    hasMore: boolean;
  }>
  | Readonly<{
    statementType: "insert" | "update" | "delete";
    resource: "cards" | "decks";
    sql: string;
    normalizedSql: string;
    rows: ReadonlyArray<SqlRow>;
    affectedCount: number;
  }>;

export type SqlExecutionPayload =
  | SqlSingleExecutionPayload
  | Readonly<{
    statementType: "batch";
    resource: null;
    sql: string;
    normalizedSql: string;
    statements: ReadonlyArray<SqlSingleExecutionPayload>;
    statementCount: number;
    affectedCountTotal: number | null;
  }>;

export type LocalSqlExecutionResult = Readonly<{
  payload: SqlExecutionPayload;
  didMutateAppState: boolean;
}>;

/**
 * Keep these aliases aligned with:
 * - `apps/backend/src/aiTools/sqlToolLimits.ts`
 * - `apps/ios/Flashcards/Flashcards/AI/LocalAISqlRuntimeModels.swift`
 * - `apps/ios/Flashcards/Flashcards/AI/LocalAIToolExecutor.swift`
 */
export const MAX_SQL_LIMIT = BACKEND_MAX_SQL_RECORD_LIMIT;
export const MAX_SQL_BATCH_STATEMENT_COUNT = BACKEND_MAX_SQL_BATCH_STATEMENT_COUNT;
