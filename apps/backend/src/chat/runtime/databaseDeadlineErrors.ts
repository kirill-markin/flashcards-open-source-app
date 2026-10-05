import {
  DatabaseDeadlineExceededError,
} from "../../database";
import {
  getDatabaseErrorFields,
} from "../../database/transient";

// Bounds the walk over error causes, which follows errors this process wrapped rather than any input.
const DATABASE_ERROR_CAUSE_MAX_DEPTH = 8;

/**
 * Recognizes each form a database deadline expiry takes in ../../database/deadline.ts: its
 * client-side error, or the `statement_timeout` (57014) or `lock_timeout` (55P03) it armed in
 * Postgres, possibly wrapped by a tool as a `cause`.
 */
export function isDatabaseDeadlineExpiry(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < DATABASE_ERROR_CAUSE_MAX_DEPTH; depth += 1) {
    if (current instanceof DatabaseDeadlineExceededError) {
      return true;
    }
    const { sqlState } = getDatabaseErrorFields(current);
    if (sqlState === "57014" || sqlState === "55P03") {
      return true;
    }
    if (!(current instanceof Error)) {
      return false;
    }
    current = current.cause;
  }

  return false;
}
