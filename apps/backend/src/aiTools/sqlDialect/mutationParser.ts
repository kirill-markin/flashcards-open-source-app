import {
  ensureSqlSourceColumnExists,
  getSqlColumnDescriptor,
} from "./schema";
import {
  assert,
  extractTopLevelClauses,
  findTopLevelClauseMatches,
  splitTopLevel,
} from "./parserSplitting";
import {
  parseSqlLiteral,
  parseStringArrayLiteralList,
  parseWherePredicate,
} from "./predicateParser";
import type {
  SqlDeleteStatement,
  SqlFromSource,
  SqlInsertStatement,
  SqlReturningClause,
  SqlUpdateStatement,
} from "./types";

const RETURNING_CLAUSE_ERROR = "RETURNING must be followed by * or a comma-separated column list";

/**
 * Splits the trailing RETURNING clause off an INSERT so the VALUES grammar
 * below never sees it. UPDATE and DELETE get the same split for free from
 * `extractTopLevelClauses`, which INSERT does not use.
 */
function splitInsertReturningSegment(normalizedSql: string): Readonly<{
  body: string;
  returningValue: string | null;
}> {
  const matches = findTopLevelClauseMatches(normalizedSql, [{ name: "returning", keyword: "RETURNING" }] as const);
  const firstMatch = matches[0];
  if (firstMatch === undefined) {
    return {
      body: normalizedSql,
      returningValue: null,
    };
  }

  if (matches.length > 1) {
    throw new Error("Duplicate INSERT clause: RETURNING");
  }

  return {
    body: normalizedSql.slice(0, firstMatch.index).trim(),
    returningValue: normalizedSql.slice(firstMatch.index + firstMatch.keyword.length).trim(),
  };
}

/**
 * RETURNING is a projection over the read surface, so it accepts every column
 * a SELECT exposes, including the read-only ones, and rejects the write-only
 * legacy inputs that `getSqlColumnDescriptor` still accepts in assignments.
 */
function parseReturningClause(resourceName: "cards" | "decks", value: string): SqlReturningClause {
  if (value === "*") {
    return { type: "all" };
  }

  const source: SqlFromSource = {
    resourceName,
    unnestColumnName: null,
    unnestAlias: null,
  };
  const columnNames = splitTopLevel(value, ",").map((item) => {
    const columnName = item.trim().toLowerCase();
    if (/^[a-z_][a-z0-9_]*$/.test(columnName) === false) {
      throw new Error(`Unsupported RETURNING item: ${item.trim()}. ${RETURNING_CLAUSE_ERROR}`);
    }

    ensureSqlSourceColumnExists(source, columnName);
    return columnName;
  });
  assert(columnNames.length > 0, RETURNING_CLAUSE_ERROR);

  return {
    type: "columns",
    columnNames,
  };
}

export function parseInsertStatement(normalizedSql: string): SqlInsertStatement {
  const { body, returningValue } = splitInsertReturningSegment(normalizedSql);
  const match = body.match(/^INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\((.+)\)\s+VALUES\s+([\s\S]+)$/i);
  if (match === null) {
    throw new Error(
      "INSERT must list columns explicitly, e.g. INSERT INTO cards (front_text, back_text, tags) VALUES ('Q?', 'A', ('tag')). Array columns use a parenthesized list; () means empty.",
    );
  }

  const resourceName = (match[1] ?? "").toLowerCase();
  if (resourceName !== "cards" && resourceName !== "decks") {
    throw new Error(`INSERT is not supported for ${resourceName}`);
  }

  const columnNames = splitTopLevel(match[2] ?? "", ",").map((columnName) => {
    const normalizedColumnName = columnName.trim().toLowerCase();
    const columnDescriptor = getSqlColumnDescriptor(resourceName, normalizedColumnName);
    if (columnDescriptor.readOnly) {
      throw new Error(`Column is read-only: ${normalizedColumnName}`);
    }

    return normalizedColumnName;
  });

  const rows = splitTopLevel(match[3] ?? "", ",").map((row) => row.trim()).filter((row) => row.startsWith("("));
  assert(rows.length > 0, "INSERT must include at least one VALUES row");

  const parsedRows = rows.map((row) => {
    assert(
      row.startsWith("(") && row.endsWith(")"),
      `Invalid VALUES row: each row must be wrapped in parentheses, e.g. ('Q?', 'A', ('tag')). Got: ${row}`,
    );
    const values = splitTopLevel(row.slice(1, -1), ",").map((value, index) => {
      const columnName = columnNames[index];
      if (columnName === undefined) {
        throw new Error(
          `VALUES row contains more values than the ${columnNames.length} declared column(s) (${columnNames.join(", ")}). Got: ${row}`,
        );
      }

      const columnDescriptor = getSqlColumnDescriptor(resourceName, columnName);
      if (columnDescriptor.type === "string[]") {
        return parseStringArrayLiteralList(value, columnName);
      }

      return parseSqlLiteral(value);
    });

    if (values.length !== columnNames.length) {
      throw new Error(
        `VALUES row does not match the ${columnNames.length} declared column(s) (${columnNames.join(", ")}); got ${values.length} value(s) in: ${row}`,
      );
    }

    return values;
  });

  return {
    type: "insert",
    resourceName,
    columnNames,
    rows: parsedRows,
    returning: returningValue === null ? null : parseReturningClause(resourceName, returningValue),
    normalizedSql,
  };
}

function parseAssignments(resourceName: "cards" | "decks", value: string): SqlUpdateStatement["assignments"] {
  return splitTopLevel(value, ",").map((assignment) => {
    const match = assignment.match(/^([a-z_][a-z0-9_]*)\s*=\s*([\s\S]+)$/i);
    if (match === null) {
      throw new Error(`Unsupported assignment: ${assignment}`);
    }

    const columnName = (match[1] ?? "").toLowerCase();
    const columnDescriptor = getSqlColumnDescriptor(resourceName, columnName);
    if (columnDescriptor.readOnly) {
      throw new Error(`Column is read-only: ${columnName}`);
    }

    return {
      columnName,
      value: columnDescriptor.type === "string[]"
        ? parseStringArrayLiteralList(match[2] ?? "", columnName)
        : parseSqlLiteral(match[2] ?? ""),
    };
  });
}

export function parseUpdateStatement(normalizedSql: string): SqlUpdateStatement {
  const match = normalizedSql.match(/^UPDATE\s+([a-z_][a-z0-9_]*)([\s\S]*)$/i);
  if (match === null) {
    throw new Error("Unsupported UPDATE statement");
  }

  const resourceName = (match[1] ?? "").toLowerCase();
  if (resourceName !== "cards" && resourceName !== "decks") {
    throw new Error(`UPDATE is not supported for ${resourceName}`);
  }

  const source: SqlFromSource = {
    resourceName,
    unnestColumnName: null,
    unnestAlias: null,
  };
  const extractedClauses = extractTopLevelClauses(
    (match[2] ?? "").trim(),
    [
      { name: "set", keyword: "SET" },
      { name: "where", keyword: "WHERE" },
      { name: "returning", keyword: "RETURNING" },
    ] as const,
    "UPDATE",
  );
  const assignmentsValue = extractedClauses.clauseValues.get("set");
  const predicateValue = extractedClauses.clauseValues.get("where");
  const returningValue = extractedClauses.clauseValues.get("returning");
  if (extractedClauses.leadingSegment !== "" || assignmentsValue === undefined || predicateValue === undefined) {
    throw new Error("Unsupported UPDATE statement");
  }

  return {
    type: "update",
    resourceName,
    assignments: parseAssignments(resourceName, assignmentsValue),
    predicate: parseWherePredicate(source, predicateValue),
    returning: returningValue === undefined ? null : parseReturningClause(resourceName, returningValue),
    normalizedSql,
  };
}

export function parseDeleteStatement(normalizedSql: string): SqlDeleteStatement {
  const match = normalizedSql.match(/^DELETE\s+FROM\s+([a-z_][a-z0-9_]*)([\s\S]*)$/i);
  if (match === null) {
    throw new Error("Unsupported DELETE statement");
  }

  const resourceName = (match[1] ?? "").toLowerCase();
  if (resourceName !== "cards" && resourceName !== "decks") {
    throw new Error(`DELETE is not supported for ${resourceName}`);
  }

  const source: SqlFromSource = {
    resourceName,
    unnestColumnName: null,
    unnestAlias: null,
  };
  const extractedClauses = extractTopLevelClauses(
    (match[2] ?? "").trim(),
    [
      { name: "where", keyword: "WHERE" },
      { name: "returning", keyword: "RETURNING" },
    ] as const,
    "DELETE",
  );
  const predicateValue = extractedClauses.clauseValues.get("where");
  const returningValue = extractedClauses.clauseValues.get("returning");
  if (extractedClauses.leadingSegment !== "" || predicateValue === undefined) {
    throw new Error("Unsupported DELETE statement");
  }

  return {
    type: "delete",
    resourceName,
    predicate: parseWherePredicate(source, predicateValue),
    returning: returningValue === undefined ? null : parseReturningClause(resourceName, returningValue),
    normalizedSql,
  };
}
