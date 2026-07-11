import { HttpError } from "../shared/errors";

export function buildInvalidSqlError(message: string): HttpError {
  return new HttpError(400, message, "QUERY_INVALID_SQL", {
    validationIssues: [{
      path: "sql",
      code: "invalid_sql",
      message,
    }],
  });
}
