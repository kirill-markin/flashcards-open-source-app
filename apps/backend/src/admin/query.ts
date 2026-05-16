import { createHash } from "node:crypto";
import type pg from "pg";
import { withTransientDatabaseRetry } from "../dbTransient";
import { HttpError } from "../errors";
import { logAdminQueryEvent } from "../server/logging";
import { withReportingReadOnlyTransaction } from "./reportingDb";

export type AdminQueryScalar = string | number | boolean | null;

export interface AdminQueryObject {
  readonly [key: string]: AdminQueryValue;
}

export interface AdminQueryArray extends ReadonlyArray<AdminQueryValue> {}

export type AdminQueryValue = AdminQueryScalar | AdminQueryArray | AdminQueryObject;

export type AdminQueryRow = Readonly<Record<string, AdminQueryValue>>;

export type AdminQueryResultSet = Readonly<{
  statementIndex: number;
  columns: ReadonlyArray<string>;
  rowCount: number;
  rows: ReadonlyArray<AdminQueryRow>;
}>;

export type AdminQueryResponse = Readonly<{
  executedAtUtc: string;
  resultSets: ReadonlyArray<AdminQueryResultSet>;
}>;

type AdminQueryExecutionDependencies = Readonly<{
  executeStatementBatchFn?: (
    statementSqlList: ReadonlyArray<string>,
  ) => Promise<ReadonlyArray<pg.QueryResult<pg.QueryResultRow>>>;
  logAdminQueryEventFn?: typeof logAdminQueryEvent;
}>;

type ExecuteAdminQueryParams = Readonly<{
  sql: string;
  adminEmail: string;
  requestId: string;
  executedAt: Date;
}> & AdminQueryExecutionDependencies;

const adminQueryDisallowedKeywordPattern = /\b(ALTER|ANALYZE|BEGIN|CALL|CHECKPOINT|COMMIT|COPY|CREATE|DEALLOCATE|DELETE|DISCARD|DO|DROP|EXECUTE|EXPLAIN|GRANT|INSERT|LISTEN|LOCK|MERGE|NOTIFY|PREPARE|REASSIGN|REFRESH|REINDEX|RELEASE|RESET|REVOKE|ROLLBACK|SAVEPOINT|SET|SHOW|START|TRUNCATE|UNLISTEN|UPDATE|VACUUM)\b/u;

function serializeAdminQueryDate(value: Date): string {
  return value.toISOString().replace(".000Z", "Z");
}

function isAsciiDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isSqlIdentifierStartCharacter(character: string): boolean {
  if (character === "_") {
    return true;
  }

  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) {
    return false;
  }

  return (
    (codePoint >= 65 && codePoint <= 90)
    || (codePoint >= 97 && codePoint <= 122)
    || codePoint >= 128
  );
}

function isSqlIdentifierCharacter(character: string): boolean {
  return isAsciiDigit(character) || isSqlIdentifierStartCharacter(character);
}

function getDollarQuoteDelimiter(value: string, startIndex: number): string | null {
  if (value[startIndex] !== "$") {
    return null;
  }

  const previousCharacter = value[startIndex - 1];
  if (
    previousCharacter !== undefined
    && (previousCharacter === "$" || isSqlIdentifierCharacter(previousCharacter))
  ) {
    return null;
  }

  let endIndex = startIndex + 1;
  while (endIndex < value.length && value[endIndex] !== "$") {
    const character = value[endIndex];
    if (endIndex === startIndex + 1) {
      if (!isSqlIdentifierStartCharacter(character)) {
        return null;
      }
    } else if (!isSqlIdentifierCharacter(character)) {
      return null;
    }

    endIndex += 1;
  }

  if (endIndex >= value.length || value[endIndex] !== "$") {
    return null;
  }

  return value.slice(startIndex, endIndex + 1);
}

function stripSqlCommentsAndLiterals(value: string): string {
  let output = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let activeDollarQuoteDelimiter: string | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextCharacter = value[index + 1];

    if (activeDollarQuoteDelimiter !== null) {
      const closingDollarQuoteDelimiter = activeDollarQuoteDelimiter;
      if (value.startsWith(closingDollarQuoteDelimiter, index)) {
        activeDollarQuoteDelimiter = null;
        index += closingDollarQuoteDelimiter.length - 1;
      }
      continue;
    }

    if (inLineComment) {
      if (character === "\n") {
        inLineComment = false;
        output += "\n";
      }
      continue;
    }

    if (inBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      if (character === "'" && nextCharacter === "'") {
        index += 1;
        continue;
      }

      if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (character === "\"" && nextCharacter === "\"") {
        index += 1;
        continue;
      }

      if (character === "\"") {
        inDoubleQuote = false;
      }
      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (character === "'") {
      inSingleQuote = true;
      continue;
    }

    if (character === "\"") {
      inDoubleQuote = true;
      continue;
    }

    const dollarQuoteDelimiter = getDollarQuoteDelimiter(value, index);
    if (dollarQuoteDelimiter !== null) {
      activeDollarQuoteDelimiter = dollarQuoteDelimiter;
      index += dollarQuoteDelimiter.length - 1;
      continue;
    }

    output += character;
  }

  return output;
}

export function splitAdminQueryStatements(sql: string): ReadonlyArray<string> {
  const trimmedSql = sql.trim();
  if (trimmedSql === "") {
    return [];
  }

  const statements: Array<string> = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let activeDollarQuoteDelimiter: string | null = null;

  for (let index = 0; index < trimmedSql.length; index += 1) {
    const character = trimmedSql[index];
    const nextCharacter = trimmedSql[index + 1];

    if (activeDollarQuoteDelimiter !== null) {
      if (trimmedSql.startsWith(activeDollarQuoteDelimiter, index)) {
        current += activeDollarQuoteDelimiter;
        index += activeDollarQuoteDelimiter.length - 1;
        activeDollarQuoteDelimiter = null;
        continue;
      }

      current += character;
      continue;
    }

    if (inLineComment) {
      current += character;
      if (character === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += character;
      if (character === "*" && nextCharacter === "/") {
        current += nextCharacter;
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      current += character;
      if (character === "'" && nextCharacter === "'") {
        current += nextCharacter;
        index += 1;
        continue;
      }

      if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += character;
      if (character === "\"" && nextCharacter === "\"") {
        current += nextCharacter;
        index += 1;
        continue;
      }

      if (character === "\"") {
        inDoubleQuote = false;
      }
      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      current += character;
      current += nextCharacter;
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      current += character;
      current += nextCharacter;
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (character === "'") {
      current += character;
      inSingleQuote = true;
      continue;
    }

    if (character === "\"") {
      current += character;
      inDoubleQuote = true;
      continue;
    }

    const dollarQuoteDelimiter = getDollarQuoteDelimiter(trimmedSql, index);
    if (dollarQuoteDelimiter !== null) {
      current += dollarQuoteDelimiter;
      activeDollarQuoteDelimiter = dollarQuoteDelimiter;
      index += dollarQuoteDelimiter.length - 1;
      continue;
    }

    if (character === ";") {
      const statement = current.trim();
      if (statement === "") {
        throw new HttpError(400, "SQL batch contains an empty statement.", "ADMIN_QUERY_INVALID_REQUEST");
      }

      statements.push(statement);
      current = "";
      continue;
    }

    current += character;
  }

  const finalStatement = current.trim();
  if (finalStatement !== "") {
    statements.push(finalStatement);
  }

  return statements;
}

function getAdminQueryFingerprint(sql: string): string {
  return createHash("sha256")
    .update(sql)
    .digest("hex");
}

function getLeadingSqlKeyword(sql: string): string | null {
  const normalizedSql = stripSqlCommentsAndLiterals(sql).trim().toUpperCase();
  const match = /^[A-Z]+/u.exec(normalizedSql);
  return match === null ? null : match[0];
}

function assertSupportedAdminStatement(statementSql: string): void {
  const normalizedSql = stripSqlCommentsAndLiterals(statementSql).trim().toUpperCase();
  const leadingKeyword = getLeadingSqlKeyword(statementSql);

  if (normalizedSql === "") {
    throw new HttpError(400, "SQL statement must not be empty.", "ADMIN_QUERY_INVALID_REQUEST");
  }

  if (leadingKeyword !== "SELECT" && leadingKeyword !== "WITH") {
    throw new HttpError(
      400,
      "Only read-only SELECT statements are supported for admin reporting.",
      "ADMIN_QUERY_INVALID_REQUEST",
    );
  }

  if (adminQueryDisallowedKeywordPattern.test(normalizedSql)) {
    throw new HttpError(
      400,
      "The SQL statement uses unsupported admin reporting syntax.",
      "ADMIN_QUERY_INVALID_REQUEST",
    );
  }
}

function isPlainAdminQueryObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || value instanceof Date) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getAdminQueryValueTypeName(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (value instanceof Date) {
    return "Date";
  }

  if (typeof value === "object") {
    const constructorName = value.constructor?.name;
    return typeof constructorName === "string" && constructorName !== ""
      ? constructorName
      : "object";
  }

  return typeof value;
}

function createUnsupportedAdminQueryValueError(valuePath: string, value: unknown): Error {
  return new Error(
    `Admin query returned unsupported value type at "${valuePath}": ${getAdminQueryValueTypeName(value)}`,
  );
}

function serializeAdminQueryValue(
  value: unknown,
  valuePath: string,
  activeObjects: WeakSet<object>,
): AdminQueryValue {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return serializeAdminQueryDate(value);
  }

  if (Array.isArray(value)) {
    if (activeObjects.has(value)) {
      throw new Error(`Admin query returned circular value at "${valuePath}"`);
    }

    activeObjects.add(value);
    const serializedArray = value.map((item, index) => serializeAdminQueryValue(
      item,
      `${valuePath}[${index}]`,
      activeObjects,
    ));
    activeObjects.delete(value);
    return serializedArray;
  }

  if (isPlainAdminQueryObject(value)) {
    if (activeObjects.has(value)) {
      throw new Error(`Admin query returned circular value at "${valuePath}"`);
    }

    activeObjects.add(value);
    const serializedObject: Record<string, AdminQueryValue> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      serializedObject[key] = serializeAdminQueryValue(
        nestedValue,
        `${valuePath}.${key}`,
        activeObjects,
      );
    }
    activeObjects.delete(value);
    return serializedObject;
  }

  throw createUnsupportedAdminQueryValueError(valuePath, value);
}

function serializeAdminQueryRows(
  rows: ReadonlyArray<pg.QueryResultRow>,
  columns: ReadonlyArray<string>,
): ReadonlyArray<AdminQueryRow> {
  return rows.map((row) => {
    const serializedRow: Record<string, AdminQueryValue> = {};
    for (const column of columns) {
      serializedRow[column] = serializeAdminQueryValue(row[column], column, new WeakSet<object>());
    }
    return serializedRow;
  });
}

function createAdminQueryResultSet(
  statementIndex: number,
  result: pg.QueryResult<pg.QueryResultRow>,
): AdminQueryResultSet {
  const columns = result.fields.map((field) => field.name);
  return {
    statementIndex,
    columns,
    rowCount: result.rowCount ?? 0,
    rows: serializeAdminQueryRows(result.rows, columns),
  };
}

async function executeReportingStatementBatch(
  statementSqlList: ReadonlyArray<string>,
): Promise<ReadonlyArray<pg.QueryResult<pg.QueryResultRow>>> {
  return withReportingReadOnlyTransaction(async (client) => {
    const results: Array<pg.QueryResult<pg.QueryResultRow>> = [];
    for (const statementSql of statementSqlList) {
      results.push(await client.query<pg.QueryResultRow>(statementSql));
    }

    return results;
  });
}

export async function executeAdminQuery(
  params: ExecuteAdminQueryParams,
): Promise<AdminQueryResponse> {
  const executeStatementBatchFn = params.executeStatementBatchFn ?? executeReportingStatementBatch;
  const logAdminQueryEventFn = params.logAdminQueryEventFn ?? logAdminQueryEvent;
  const sqlFingerprint = getAdminQueryFingerprint(params.sql);
  const startedAt = Date.now();
  let statementCount = 0;

  try {
    const statementSqlList = splitAdminQueryStatements(params.sql);
    statementCount = statementSqlList.length;
    if (statementSqlList.length === 0) {
      throw new HttpError(400, "sql must not be empty.", "ADMIN_QUERY_INVALID_REQUEST");
    }

    for (const statementSql of statementSqlList) {
      assertSupportedAdminStatement(statementSql);
    }

    const resultSets: Array<AdminQueryResultSet> = [];
    const statementResults = await withTransientDatabaseRetry(
      async () => executeStatementBatchFn(statementSqlList),
    );
    if (statementResults.length !== statementSqlList.length) {
      throw new Error("Admin query executor returned a mismatched number of statement results.");
    }

    for (const [statementIndex, result] of statementResults.entries()) {
      resultSets.push(createAdminQueryResultSet(statementIndex, result));
    }

    logAdminQueryEventFn({
      requestId: params.requestId,
      adminEmail: params.adminEmail,
      durationMs: Date.now() - startedAt,
      statementCount,
      success: true,
      sqlFingerprint,
    });

    return {
      executedAtUtc: serializeAdminQueryDate(params.executedAt),
      resultSets,
    };
  } catch (error) {
    logAdminQueryEventFn({
      requestId: params.requestId,
      adminEmail: params.adminEmail,
      durationMs: Date.now() - startedAt,
      statementCount,
      success: false,
      sqlFingerprint,
    });
    throw error;
  }
}
