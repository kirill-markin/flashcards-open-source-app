import { HttpError } from "../shared/errors";

/**
 * Reason family of a rejected agent SQL string, published as
 * `validationIssues[0].code` and recorded as `dialectReason` telemetry so
 * failures can be grouped by cause. The message carries the specific detail.
 */
export type SqlDialectReason =
  | "empty_sql"
  | "wrong_tool_for_statement"
  | "batch_too_large"
  | "unknown_resource"
  | "unknown_column"
  | "column_not_filterable"
  | "column_read_only"
  | "unsupported_statement"
  | "unsupported_expression"
  | "invalid_clause"
  | "invalid_grouping"
  | "invalid_value";

/**
 * Parse-time rejection of model-authored SQL. The parse wrappers in
 * `apps/backend/src/aiTools/agentSql.ts` turn it into `buildInvalidSqlError`.
 */
export class SqlDialectError extends Error {
  constructor(message: string, readonly reason: SqlDialectReason) {
    super(message);
    this.name = "SqlDialectError";
  }
}

export function buildInvalidSqlError(message: string, reason: SqlDialectReason): HttpError {
  return new HttpError(400, message, "QUERY_INVALID_SQL", {
    validationIssues: [{
      path: "sql",
      code: reason,
      message,
    }],
  });
}
