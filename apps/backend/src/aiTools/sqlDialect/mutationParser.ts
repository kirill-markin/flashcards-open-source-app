import { getSqlColumnDescriptor } from "./schema";
import {
  assert,
  extractTopLevelClauses,
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
  SqlUpdateStatement,
} from "./types";

export function parseInsertStatement(normalizedSql: string): SqlInsertStatement {
  const match = normalizedSql.match(/^INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\((.+)\)\s+VALUES\s+([\s\S]+)$/i);
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
    ] as const,
    "UPDATE",
  );
  const assignmentsValue = extractedClauses.clauseValues.get("set");
  const predicateValue = extractedClauses.clauseValues.get("where");
  if (extractedClauses.leadingSegment !== "" || assignmentsValue === undefined || predicateValue === undefined) {
    throw new Error("Unsupported UPDATE statement");
  }

  return {
    type: "update",
    resourceName,
    assignments: parseAssignments(resourceName, assignmentsValue),
    predicate: parseWherePredicate(source, predicateValue),
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
    [{ name: "where", keyword: "WHERE" }] as const,
    "DELETE",
  );
  const predicateValue = extractedClauses.clauseValues.get("where");
  if (extractedClauses.leadingSegment !== "" || predicateValue === undefined) {
    throw new Error("Unsupported DELETE statement");
  }

  return {
    type: "delete",
    resourceName,
    predicate: parseWherePredicate(source, predicateValue),
    normalizedSql,
  };
}
