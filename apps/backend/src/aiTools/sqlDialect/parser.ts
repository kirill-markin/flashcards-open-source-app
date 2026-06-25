import {
  ensureSqlSourceColumnExists,
  isSqlResourceName,
} from "./schema";
import {
  parseDeleteStatement,
  parseInsertStatement,
  parseUpdateStatement,
} from "./mutationParser";
import {
  parsePredicateClauses,
  parseStringLiteral,
} from "./predicateParser";
import {
  extractTopLevelClauses,
  findTopLevelClauseMatches,
  normalizeSqlWhitespace,
  splitSqlStatements,
  splitTopLevel,
  upperCaseKeyword,
} from "./parserSplitting";
import type {
  ParsedSqlStatement,
  SqlAggregateFunctionName,
  SqlFromSource,
  SqlOrderDirection,
  SqlSelectItem,
  SqlSelectOrderBy,
  SqlSelectStatement,
  SqlShowTablesStatement,
} from "./types";

export { splitSqlStatements } from "./parserSplitting";

function parseSimpleNumberClauseValue(value: string | undefined, keyword: string): number | null {
  if (value === undefined) {
    return null;
  }

  const trimmedValue = value.trim();
  if (/^\d+$/u.test(trimmedValue) === false) {
    throw new Error(`${keyword} must be a non-negative integer`);
  }

  return Number.parseInt(trimmedValue, 10);
}

function parseOrderBy(value: string): ReadonlyArray<SqlSelectOrderBy> {
  const items = splitTopLevel(value, ",").map((item) => item.trim());
  if (items.length === 1 && /^RANDOM\s*\(\s*\)$/i.test(items[0] ?? "")) {
    return [{ type: "random" }];
  }

  for (const item of items) {
    if (/^RANDOM\s*\(\s*\)\s+(ASC|DESC)$/i.test(item)) {
      throw new Error("RANDOM() does not support ASC or DESC");
    }
  }

  if (items.some((item) => /^RANDOM\s*\(\s*\)$/i.test(item))) {
    throw new Error("RANDOM() must be the only ORDER BY item");
  }

  return items.map((item) => {
    const match = item.match(/^([a-z_][a-z0-9_]*)(?:\s+(ASC|DESC))?$/i);
    if (match === null) {
      throw new Error(`Unsupported ORDER BY item: ${item}`);
    }

    return {
      type: "column",
      expressionName: (match[1] ?? "").toLowerCase(),
      direction: ((match[2] ?? "ASC").toLowerCase()) as SqlOrderDirection,
    };
  });
}

function parseFromSource(
  resourceName: string,
  unnestColumnName: string | undefined,
  unnestAlias: string | undefined,
): SqlFromSource {
  const normalizedResourceName = resourceName.toLowerCase();
  if (isSqlResourceName(normalizedResourceName) === false) {
    throw new Error(`Unknown resource: ${normalizedResourceName}`);
  }

  if (unnestColumnName === undefined && unnestAlias === undefined) {
    return {
      resourceName: normalizedResourceName,
      unnestColumnName: null,
      unnestAlias: null,
    };
  }

  const normalizedUnnestColumnName = (unnestColumnName ?? "").toLowerCase();
  const normalizedUnnestAlias = (unnestAlias ?? "").toLowerCase();
  if (normalizedResourceName !== "cards" || normalizedUnnestColumnName !== "tags") {
    throw new Error("UNNEST is only supported for cards.tags");
  }

  return {
    resourceName: normalizedResourceName,
    unnestColumnName: "tags",
    unnestAlias: normalizedUnnestAlias,
  };
}

function parseAliasedExpression(value: string): Readonly<{
  expression: string;
  alias: string | null;
}> {
  const match = value.match(/^([\s\S]+?)\s+AS\s+([a-z_][a-z0-9_]*)$/i);
  if (match === null) {
    return {
      expression: value.trim(),
      alias: null,
    };
  }

  return {
    expression: (match[1] ?? "").trim(),
    alias: (match[2] ?? "").toLowerCase(),
  };
}

function parseSelectItem(source: SqlFromSource, value: string): SqlSelectItem {
  const trimmedValue = value.trim();
  if (trimmedValue === "*") {
    return { type: "wildcard" };
  }

  const { expression, alias } = parseAliasedExpression(trimmedValue);
  const countMatch = expression.match(/^COUNT\s*\(\s*\*\s*\)$/i);
  if (countMatch !== null) {
    return {
      type: "aggregate",
      functionName: "count",
      columnName: null,
      alias,
    };
  }

  const aggregateMatch = expression.match(/^(SUM|AVG|MIN|MAX)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)$/i);
  if (aggregateMatch !== null) {
    const columnName = (aggregateMatch[2] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "aggregate",
      functionName: (aggregateMatch[1] ?? "").toLowerCase() as Exclude<SqlAggregateFunctionName, "count">,
      columnName,
      alias,
    };
  }

  const columnMatch = expression.match(/^([a-z_][a-z0-9_]*)$/i);
  if (columnMatch !== null) {
    const columnName = (columnMatch[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "column",
      columnName,
      alias,
    };
  }

  throw new Error(`Unsupported SELECT item: ${trimmedValue}`);
}

function parseSelectStatement(normalizedSql: string): SqlSelectStatement {
  const selectPrefixMatch = normalizedSql.match(/^SELECT\s+/i);
  if (selectPrefixMatch === null) {
    throw new Error("Unsupported SELECT statement");
  }

  const selectBody = normalizedSql.slice(selectPrefixMatch[0].length);
  const fromMatch = findTopLevelClauseMatches(selectBody, [{ name: "from", keyword: "FROM" }] as const)[0];
  if (fromMatch === undefined) {
    throw new Error("Unsupported SELECT statement");
  }

  const selectItemsSegment = selectBody.slice(0, fromMatch.index).trim();
  const fromAndTailSegment = selectBody.slice(fromMatch.index + fromMatch.keyword.length).trim();
  const extractedClauses = extractTopLevelClauses(
    fromAndTailSegment,
    [
      { name: "where", keyword: "WHERE" },
      { name: "groupBy", keyword: "GROUP BY" },
      { name: "orderBy", keyword: "ORDER BY" },
      { name: "limit", keyword: "LIMIT" },
      { name: "offset", keyword: "OFFSET" },
    ] as const,
    "SELECT",
  );
  const sourceMatch = extractedClauses.leadingSegment.match(
    /^([a-z_][a-z0-9_]*)(?:\s+UNNEST\s+([a-z_][a-z0-9_]*)\s+AS\s+([a-z_][a-z0-9_]*))?$/i,
  );
  if (sourceMatch === null) {
    throw new Error("Unsupported SELECT statement");
  }

  const source = parseFromSource(sourceMatch[1] ?? "", sourceMatch[2], sourceMatch[3]);
  const selectItems = splitTopLevel(selectItemsSegment, ",").map((item) => parseSelectItem(source, item));
  const groupByValue = extractedClauses.clauseValues.get("groupBy");
  const groupBy = groupByValue === undefined
    ? []
    : splitTopLevel(groupByValue, ",").map((item) => {
      const normalizedItem = item.trim().toLowerCase();
      ensureSqlSourceColumnExists(source, normalizedItem);
      return normalizedItem;
    });
  const limit = parseSimpleNumberClauseValue(extractedClauses.clauseValues.get("limit"), "LIMIT");
  const offset = parseSimpleNumberClauseValue(extractedClauses.clauseValues.get("offset"), "OFFSET");

  const wildcardSelect = selectItems.length === 1 && selectItems[0]?.type === "wildcard";
  const hasAggregateSelectItem = selectItems.some((item) => item.type === "aggregate");
  if (wildcardSelect && groupBy.length > 0) {
    throw new Error("GROUP BY is not supported with SELECT *");
  }

  const requiresGroupedColumns = hasAggregateSelectItem || groupBy.length > 0;
  for (const item of selectItems) {
    if (requiresGroupedColumns && item.type === "column" && groupBy.includes(item.columnName) === false) {
      throw new Error(`Grouped SELECT must list ${item.columnName} in GROUP BY`);
    }
  }

  if (requiresGroupedColumns && source.unnestAlias !== null && groupBy.includes(source.unnestAlias) === false) {
    const referencesAlias = selectItems.some((item) => item.type === "column" && item.columnName === source.unnestAlias);
    if (referencesAlias) {
      throw new Error(`Grouped SELECT must list ${source.unnestAlias} in GROUP BY`);
    }
  }

  return {
    type: "select",
    source,
    selectItems,
    predicateClauses: extractedClauses.clauseValues.has("where")
      ? parsePredicateClauses(source, extractedClauses.clauseValues.get("where") ?? "")
      : [],
    groupBy,
    orderBy: extractedClauses.clauseValues.has("orderBy")
      ? parseOrderBy(extractedClauses.clauseValues.get("orderBy") ?? "")
      : [],
    limit,
    offset,
    normalizedSql,
  };
}

function parseShowTablesStatement(normalizedSql: string): SqlShowTablesStatement | null {
  const match = normalizedSql.match(/^SHOW\s+TABLES(?:\s+LIKE\s+('(?:''|[^'])*'))?$/i);
  if (match === null) {
    return null;
  }

  return {
    type: "show_tables",
    likePattern: match[1] === undefined ? null : parseStringLiteral(match[1]),
    normalizedSql,
  };
}

function parseDescribeStatement(normalizedSql: string): ParsedSqlStatement | null {
  const match = normalizedSql.match(/^(?:DESCRIBE|SHOW\s+COLUMNS\s+FROM)\s+([a-z_][a-z0-9_]*)$/i);
  if (match === null) {
    return null;
  }

  const resourceName = (match[1] ?? "").toLowerCase();
  if (isSqlResourceName(resourceName) === false) {
    throw new Error(`Unknown resource: ${resourceName}`);
  }

  return {
    type: "describe",
    resourceName,
    normalizedSql,
  };
}

/**
 * Canonical SQL-dialect parser for backend and browser-local runtimes.
 *
 * iOS mirror:
 * `apps/backend/src/aiTools/sqlDialect/parser.ts::parseSqlStatement`
 */
export function parseSqlStatement(value: string): ParsedSqlStatement {
  const normalizedSql = normalizeSqlWhitespace(value);
  if (normalizedSql === "") {
    throw new Error("sql must not be empty");
  }

  const showTablesStatement = parseShowTablesStatement(normalizedSql);
  if (showTablesStatement !== null) {
    return showTablesStatement;
  }

  const describeStatement = parseDescribeStatement(normalizedSql);
  if (describeStatement !== null) {
    return describeStatement;
  }

  const statementKeyword = upperCaseKeyword(normalizedSql.split(" ", 1)[0] ?? "");
  if (statementKeyword === "SELECT") {
    return parseSelectStatement(normalizedSql);
  }

  if (statementKeyword === "INSERT") {
    return parseInsertStatement(normalizedSql);
  }

  if (statementKeyword === "UPDATE") {
    return parseUpdateStatement(normalizedSql);
  }

  if (statementKeyword === "DELETE") {
    return parseDeleteStatement(normalizedSql);
  }

  throw new Error("Unsupported SQL statement");
}

export function parseSqlStatements(value: string): ReadonlyArray<ParsedSqlStatement> {
  const statementValues = splitSqlStatements(value);
  if (statementValues.length === 0) {
    throw new Error("sql must not be empty");
  }

  return statementValues.map((statementValue) => parseSqlStatement(statementValue));
}
