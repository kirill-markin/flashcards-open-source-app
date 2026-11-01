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

const maximumRejectedNameLength = 120;

/**
 * Parse-time rejection of model-authored SQL. The parse wrappers in
 * `apps/backend/src/aiTools/agentSql.ts` turn it into `buildInvalidSqlError`.
 *
 * `rejectedName` is the identifier, function, or keyword the dialect refused, as
 * the parser extracted it, or null when the only detail is a SQL fragment.
 */
export class SqlDialectError extends Error {
  constructor(message: string, readonly reason: SqlDialectReason, readonly rejectedName: string | null) {
    super(message);
    this.name = "SqlDialectError";
  }
}

// The name is recorded permanently in telemetry, so anything not shaped like a
// single SQL identifier, such as a quoted literal some callers pass unvalidated,
// is dropped rather than stored.
function normalizeRejectedName(rejectedName: string): string | null {
  const trimmedName = rejectedName.trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedName) ? trimmedName.slice(0, maximumRejectedNameLength) : null;
}

export function buildInvalidSqlError(
  message: string,
  reason: SqlDialectReason,
  rejectedName: string | null,
): HttpError {
  return new HttpError(400, message, "QUERY_INVALID_SQL", {
    validationIssues: [{
      path: "sql",
      code: reason,
      message,
    }],
    sqlRejectedName: rejectedName === null ? null : normalizeRejectedName(rejectedName),
  });
}
