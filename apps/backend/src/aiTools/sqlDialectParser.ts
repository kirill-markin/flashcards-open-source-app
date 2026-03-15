import {
  ensureSqlSourceColumnExists,
  getSqlColumnDescriptor,
  isSqlResourceName,
} from "./sqlDialectSchema";
import type {
  ParsedSqlStatement,
  SqlAggregateFunctionName,
  SqlComparisonOperator,
  SqlDeleteStatement,
  SqlFromSource,
  SqlInsertStatement,
  SqlLiteral,
  SqlOrderDirection,
  SqlPredicate,
  SqlPredicateClause,
  SqlPredicateValue,
  SqlSelectItem,
  SqlSelectOrderBy,
  SqlSelectStatement,
  SqlShowTablesStatement,
  SqlUpdateStatement,
} from "./sqlDialectTypes";

function upperCaseKeyword(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeSqlWhitespace(value: string): string {
  const trimmedValue = value.trim();
  let normalizedValue = "";
  let inString = false;
  let pendingWhitespace = false;

  for (let index = 0; index < trimmedValue.length; index += 1) {
    const character = trimmedValue[index];
    const nextCharacter = trimmedValue[index + 1];

    if (character === "'") {
      if (pendingWhitespace && normalizedValue !== "") {
        normalizedValue += " ";
        pendingWhitespace = false;
      }

      normalizedValue += character;
      if (inString && nextCharacter === "'") {
        normalizedValue += nextCharacter;
        index += 1;
        continue;
      }

      inString = !inString;
      continue;
    }

    if (inString) {
      normalizedValue += character;
      continue;
    }

    if (/\s/u.test(character)) {
      pendingWhitespace = true;
      continue;
    }

    if (character === ";" && trimmedValue.slice(index + 1).trim() === "") {
      break;
    }

    if (pendingWhitespace && normalizedValue !== "") {
      normalizedValue += " ";
      pendingWhitespace = false;
    }

    normalizedValue += character;
  }

  return normalizedValue;
}

function assert(condition: boolean, message: string): void {
  if (condition === false) {
    throw new Error(message);
  }
}

function splitTopLevel(value: string, separator: string): ReadonlyArray<string> {
  const parts: Array<string> = [];
  let current = "";
  let inString = false;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextCharacter = value[index + 1];
    if (character === "'") {
      current += character;
      if (inString && nextCharacter === "'") {
        current += nextCharacter;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (inString) {
      current += character;
      continue;
    }

    if (character === "(") {
      depth += 1;
      current += character;
      continue;
    }

    if (character === ")") {
      depth -= 1;
      current += character;
      continue;
    }

    if (depth === 0 && value.slice(index, index + separator.length).toUpperCase() === separator) {
      parts.push(current.trim());
      current = "";
      index += separator.length - 1;
      continue;
    }

    current += character;
  }

  if (current.trim() !== "") {
    parts.push(current.trim());
  }

  return parts;
}

function splitTopLevelByKeyword(value: string, keyword: "AND" | "OR"): ReadonlyArray<string> {
  const parts: Array<string> = [];
  let current = "";
  let inString = false;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextCharacter = value[index + 1];
    if (character === "'") {
      current += character;
      if (inString && nextCharacter === "'") {
        current += nextCharacter;
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (inString) {
      current += character;
      continue;
    }

    if (character === "(") {
      depth += 1;
      current += character;
      continue;
    }

    if (character === ")") {
      depth -= 1;
      current += character;
      continue;
    }

    if (
      depth === 0
      && value.slice(index, index + keyword.length).toUpperCase() === keyword
      && (index === 0 || /\s/.test(value[index - 1] ?? ""))
      && (index + keyword.length >= value.length || /\s/.test(value[index + keyword.length] ?? ""))
    ) {
      parts.push(current.trim());
      current = "";
      index += keyword.length - 1;
      continue;
    }

    current += character;
  }

  if (current.trim() !== "") {
    parts.push(current.trim());
  }

  return parts;
}

type TopLevelClauseDefinition<TName extends string> = Readonly<{
  name: TName;
  keyword: string;
}>;

type TopLevelClauseMatch<TName extends string> = Readonly<{
  name: TName;
  keyword: string;
  index: number;
}>;

function isSqlBoundaryCharacter(value: string | undefined): boolean {
  return value === undefined || /\s/u.test(value);
}

function findTopLevelClauseMatches<TName extends string>(
  value: string,
  definitions: ReadonlyArray<TopLevelClauseDefinition<TName>>,
): ReadonlyArray<TopLevelClauseMatch<TName>> {
  const matches: Array<TopLevelClauseMatch<TName>> = [];
  const normalizedDefinitions = [...definitions].sort((left, right) => right.keyword.length - left.keyword.length);
  let inString = false;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const nextCharacter = value[index + 1];
    if (character === "'") {
      if (inString && nextCharacter === "'") {
        index += 1;
        continue;
      }

      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character === ")") {
      depth -= 1;
      continue;
    }

    if (depth !== 0) {
      continue;
    }

    const matchedDefinition = normalizedDefinitions.find((definition) => {
      if (value.slice(index, index + definition.keyword.length).toUpperCase() !== definition.keyword) {
        return false;
      }

      return isSqlBoundaryCharacter(value[index - 1]) && isSqlBoundaryCharacter(value[index + definition.keyword.length]);
    });
    if (matchedDefinition === undefined) {
      continue;
    }

    matches.push({
      name: matchedDefinition.name,
      keyword: matchedDefinition.keyword,
      index,
    });
    index += matchedDefinition.keyword.length - 1;
  }

  return matches;
}

function extractTopLevelClauses<TName extends string>(
  value: string,
  definitions: ReadonlyArray<TopLevelClauseDefinition<TName>>,
  context: string,
): Readonly<{
  leadingSegment: string;
  clauseValues: ReadonlyMap<TName, string>;
}> {
  const matches = findTopLevelClauseMatches(value, definitions);
  if (matches.length === 0) {
    return {
      leadingSegment: value.trim(),
      clauseValues: new Map(),
    };
  }

  const definitionOrder = new Map(definitions.map((definition, index) => [definition.name, index] as const));
  const clauseValues = new Map<TName, string>();
  let lastOrder = -1;

  for (const [index, match] of matches.entries()) {
    if (clauseValues.has(match.name)) {
      throw new Error(`Duplicate ${context} clause: ${match.keyword}`);
    }

    const order = definitionOrder.get(match.name);
    if (order === undefined) {
      throw new Error(`Unknown ${context} clause: ${match.keyword}`);
    }
    if (order < lastOrder) {
      throw new Error(`Invalid ${context} clause order near ${match.keyword}`);
    }

    const nextMatch = matches[index + 1];
    const clauseValue = value.slice(match.index + match.keyword.length, nextMatch?.index).trim();
    clauseValues.set(match.name, clauseValue);
    lastOrder = order;
  }

  const firstMatch = matches[0];
  assert(firstMatch !== undefined, `Expected at least one ${context} clause`);
  return {
    leadingSegment: value.slice(0, firstMatch.index).trim(),
    clauseValues,
  };
}

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

function parseStringLiteral(value: string): string {
  assert(value.startsWith("'") && value.endsWith("'"), "Expected a quoted string literal");
  return value.slice(1, -1).replaceAll("''", "'");
}

function parseSqlLiteral(value: string): SqlLiteral {
  const trimmedValue = value.trim();
  if (trimmedValue.toUpperCase() === "NULL") {
    return null;
  }

  if (trimmedValue.toUpperCase() === "TRUE") {
    return true;
  }

  if (trimmedValue.toUpperCase() === "FALSE") {
    return false;
  }

  if (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")) {
    return parseStringLiteral(trimmedValue);
  }

  if (/^-?\d+$/.test(trimmedValue)) {
    return Number.parseInt(trimmedValue, 10);
  }

  if (/^-?\d+\.\d+$/.test(trimmedValue)) {
    return Number.parseFloat(trimmedValue);
  }

  throw new Error(`Unsupported literal: ${trimmedValue}`);
}

function parsePredicateValue(value: string): SqlPredicateValue {
  const trimmedValue = value.trim();
  if (trimmedValue.toUpperCase() === "NOW()") {
    return { type: "now" };
  }

  return parseSqlLiteral(trimmedValue);
}

function parseStringArrayLiteralList(value: string): ReadonlyArray<string> {
  const trimmedValue = value.trim();
  assert(trimmedValue.startsWith("(") && trimmedValue.endsWith(")"), "Expected a parenthesized value list");
  const innerValue = trimmedValue.slice(1, -1).trim();
  if (innerValue === "") {
    return [];
  }

  return splitTopLevel(innerValue, ",").map((item) => {
    const parsedValue = parseSqlLiteral(item);
    if (typeof parsedValue !== "string") {
      throw new Error("Expected only string literals in the list");
    }

    return parsedValue;
  });
}

function parsePredicate(source: SqlFromSource, value: string): SqlPredicate {
  const trimmedValue = value.trim();
  const matchPredicate = trimmedValue.match(/^MATCH\s*\(\s*('(?:''|[^'])*')\s*\)$/i);
  if (matchPredicate !== null) {
    return {
      type: "match",
      query: parseStringLiteral(matchPredicate[1] ?? ""),
    };
  }

  const loweredLikePredicate = trimmedValue.match(/^LOWER\s*\(\s*([a-z_][a-z0-9_]*)\s*\)\s+LIKE\s+('(?:''|[^'])*')$/i);
  if (loweredLikePredicate !== null) {
    const columnName = (loweredLikePredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "like",
      columnName,
      pattern: parseStringLiteral(loweredLikePredicate[2] ?? ""),
      caseInsensitive: true,
    };
  }

  const likePredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+LIKE\s+('(?:''|[^'])*')$/i);
  if (likePredicate !== null) {
    const columnName = (likePredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "like",
      columnName,
      pattern: parseStringLiteral(likePredicate[2] ?? ""),
      caseInsensitive: false,
    };
  }

  const isNotNullPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+IS\s+NOT\s+NULL$/i);
  if (isNotNullPredicate !== null) {
    const columnName = (isNotNullPredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "is_not_null",
      columnName,
    };
  }

  const isNullPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+IS\s+NULL$/i);
  if (isNullPredicate !== null) {
    const columnName = (isNullPredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "is_null",
      columnName,
    };
  }

  const overlapPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+OVERLAP\s*(\(.+\))$/i);
  if (overlapPredicate !== null) {
    const columnName = (overlapPredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "overlap",
      columnName,
      values: parseStringArrayLiteralList(overlapPredicate[2] ?? ""),
    };
  }

  const inPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+IN\s*(\(.+\))$/i);
  if (inPredicate !== null) {
    const columnName = (inPredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "in",
      columnName,
      values: splitTopLevel((inPredicate[2] ?? "").slice(1, -1), ",").map(parseSqlLiteral),
    };
  }

  const comparisonPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s*(=|<=|>=|<|>)\s*(.+)$/i);
  if (comparisonPredicate !== null) {
    const columnName = (comparisonPredicate[1] ?? "").toLowerCase();
    ensureSqlSourceColumnExists(source, columnName);
    return {
      type: "comparison",
      columnName,
      operator: (comparisonPredicate[2] ?? "=") as SqlComparisonOperator,
      value: parsePredicateValue(comparisonPredicate[3] ?? ""),
    };
  }

  throw new Error(`Unsupported predicate: ${trimmedValue}`);
}

function parsePredicateClauses(source: SqlFromSource, value: string): ReadonlyArray<SqlPredicateClause> {
  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return [];
  }

  return splitTopLevelByKeyword(trimmedValue, "OR").map((clause) =>
    splitTopLevelByKeyword(clause, "AND").map((predicate) => parsePredicate(source, predicate)));
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

function parseInsertStatement(normalizedSql: string): SqlInsertStatement {
  const match = normalizedSql.match(/^INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\((.+)\)\s+VALUES\s+([\s\S]+)$/i);
  if (match === null) {
    throw new Error("Unsupported INSERT statement");
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
    assert(row.startsWith("(") && row.endsWith(")"), "Invalid VALUES row");
    const values = splitTopLevel(row.slice(1, -1), ",").map((value, index) => {
      const columnName = columnNames[index];
      if (columnName === undefined) {
        throw new Error("VALUES row contains more values than columns");
      }

      const columnDescriptor = getSqlColumnDescriptor(resourceName, columnName);
      if (columnDescriptor.type === "string[]") {
        return parseStringArrayLiteralList(value);
      }

      return parseSqlLiteral(value);
    });

    if (values.length !== columnNames.length) {
      throw new Error("VALUES row does not match the declared column count");
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
        ? parseStringArrayLiteralList(match[2] ?? "")
        : parseSqlLiteral(match[2] ?? ""),
    };
  });
}

function parseUpdateStatement(normalizedSql: string): SqlUpdateStatement {
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
    predicateClauses: parsePredicateClauses(source, predicateValue),
    normalizedSql,
  };
}

function parseDeleteStatement(normalizedSql: string): SqlDeleteStatement {
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
    predicateClauses: parsePredicateClauses(source, predicateValue),
    normalizedSql,
  };
}

/**
 * Canonical SQL-dialect parser for backend and browser-local runtimes.
 *
 * iOS mirror:
 * `apps/ios/Flashcards/Flashcards/AI/LocalAISqlDialect.swift::localAISqlParseStatement`
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
