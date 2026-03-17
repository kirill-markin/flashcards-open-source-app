import { getSqlSourceColumnDescriptors } from "./sqlDialectSchema";
import type {
  SqlAggregateFunctionName,
  SqlFromSource,
  SqlLiteral,
  SqlPredicate,
  SqlPredicateClause,
  SqlPredicateValue,
  SqlRow,
  SqlRowScalar,
  SqlRowValue,
  SqlSelectExecutionResult,
  SqlSelectItem,
  SqlSelectOrderBy,
  SqlSelectStatement,
} from "./sqlDialectTypes";

function defaultAggregateAlias(functionName: SqlAggregateFunctionName, columnName: string | null): string {
  if (functionName === "count") {
    return "count";
  }

  return `${functionName}_${columnName ?? "value"}`;
}

function resolvePredicateValue(value: SqlPredicateValue): SqlLiteral {
  if (typeof value === "object" && value !== null && value.type === "now") {
    return new Date().toISOString();
  }

  return value as SqlLiteral;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createLikePatternRegExp(value: string, caseInsensitive: boolean): RegExp {
  const escaped = escapeRegExp(value).replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, caseInsensitive ? "i" : "");
}

export function likePatternToRegExp(value: string): RegExp {
  return createLikePatternRegExp(value, true);
}

export function normalizeSqlLimit(limit: number | null, maximumLimit: number): number {
  if (limit === null) {
    return maximumLimit;
  }

  if (limit < 1) {
    throw new Error("LIMIT must be greater than 0");
  }

  return Math.min(limit, maximumLimit);
}

export function normalizeSqlOffset(offset: number | null): number {
  if (offset === null) {
    return 0;
  }

  if (offset < 0) {
    throw new Error("OFFSET must be a non-negative integer");
  }

  return offset;
}

function normalizeSearchableText(value: SqlRowValue | undefined): string {
  if (Array.isArray(value)) {
    return value.join(" ").toLowerCase();
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).toLowerCase();
}

function compareRowValues(left: SqlRowValue | undefined, right: SqlRowValue | undefined): number {
  if (left === undefined && right === undefined) {
    return 0;
  }

  if (left === undefined || left === null) {
    return right === undefined || right === null ? 0 : -1;
  }

  if (right === undefined || right === null) {
    return 1;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    const leftText = Array.isArray(left) ? left.join("\u0000") : String(left);
    const rightText = Array.isArray(right) ? right.join("\u0000") : String(right);
    return leftText.localeCompare(rightText);
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return String(left).localeCompare(String(right));
}

function valuesEqual(left: SqlRowValue | undefined, right: SqlLiteral): boolean {
  if (left === undefined || Array.isArray(left)) {
    return false;
  }

  return left === right;
}

function compareScalarValues(left: SqlRowValue | undefined, right: SqlLiteral): number | null {
  if (left === undefined || left === null || Array.isArray(left) || right === null) {
    return null;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return String(left).localeCompare(String(right));
}

function normalizeStringArray(value: SqlRowValue | undefined): ReadonlyArray<string> {
  if (value === undefined || value === null || Array.isArray(value) === false) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function rowMatchesInPredicate(columnValue: SqlRowValue | undefined, predicate: Extract<SqlPredicate, { type: "in" }>): boolean {
  if (predicate.caseInsensitive) {
    if (typeof columnValue !== "string") {
      return false;
    }

    const normalizedColumnValue = columnValue.toLowerCase();
    const hasMatch = predicate.values.some((value) => typeof value === "string" && normalizedColumnValue === value.toLowerCase());
    return predicate.isNegated ? hasMatch === false : hasMatch;
  }

  const hasMatch = predicate.values.some((value) => valuesEqual(columnValue, value));
  return predicate.isNegated ? hasMatch === false : hasMatch;
}

function validatePredicate(source: SqlFromSource, predicate: SqlPredicate): void {
  if (predicate.type === "match") {
    return;
  }

  const columnDescriptor = getSqlSourceColumnDescriptors(source)[predicate.columnName];
  if (columnDescriptor === undefined) {
    throw new Error(`Unknown column for ${source.resourceName}: ${predicate.columnName}`);
  }

  if (columnDescriptor.filterable === false) {
    throw new Error(`Column is not filterable: ${predicate.columnName}`);
  }
}

function rowMatchesPredicate(row: SqlRow, predicate: SqlPredicate): boolean {
  if (predicate.type === "match") {
    const normalizedQuery = predicate.query.trim().toLowerCase();
    if (normalizedQuery === "") {
      throw new Error("MATCH query must not be empty");
    }

    return Object.values(row).some((value) => normalizeSearchableText(value).includes(normalizedQuery));
  }

  if (predicate.type === "like") {
    const columnValue = row[predicate.columnName];
    if (typeof columnValue !== "string") {
      return false;
    }

    return createLikePatternRegExp(predicate.pattern, predicate.caseInsensitive).test(columnValue);
  }

  const columnValue = row[predicate.columnName];
  if (predicate.type === "comparison") {
    const predicateValue = resolvePredicateValue(predicate.value);
    if (predicate.operator === "=") {
      return valuesEqual(columnValue, predicateValue);
    }

    const comparison = compareScalarValues(columnValue, predicateValue);
    if (comparison === null) {
      return false;
    }

    if (predicate.operator === "<") {
      return comparison < 0;
    }

    if (predicate.operator === "<=") {
      return comparison <= 0;
    }

    if (predicate.operator === ">") {
      return comparison > 0;
    }

    return comparison >= 0;
  }

  if (predicate.type === "in") {
    return rowMatchesInPredicate(columnValue, predicate);
  }

  if (predicate.type === "is_null") {
    return columnValue === null;
  }

  if (predicate.type === "is_not_null") {
    return columnValue !== null && columnValue !== undefined;
  }

  return normalizeStringArray(columnValue).some((value) => predicate.values.includes(value));
}

function applyPredicateClauses(
  source: SqlFromSource,
  rows: ReadonlyArray<SqlRow>,
  predicateClauses: ReadonlyArray<SqlPredicateClause>,
): ReadonlyArray<SqlRow> {
  for (const clause of predicateClauses) {
    for (const predicate of clause) {
      validatePredicate(source, predicate);
    }
  }

  if (predicateClauses.length === 0) {
    return rows;
  }

  return rows.filter((row) => predicateClauses.some((clause) => clause.every((predicate) => rowMatchesPredicate(row, predicate))));
}

function applyOrderBy(
  rows: ReadonlyArray<SqlRow>,
  orderBy: ReadonlyArray<SqlSelectOrderBy>,
): ReadonlyArray<SqlRow> {
  if (orderBy.length === 0) {
    return rows;
  }

  if (orderBy.length === 1 && orderBy[0]?.type === "random") {
    const shuffledRows = [...rows];
    for (let index = shuffledRows.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffledRows[index], shuffledRows[swapIndex]] = [shuffledRows[swapIndex] as SqlRow, shuffledRows[index] as SqlRow];
    }
    return shuffledRows;
  }

  return [...rows].sort((left, right) => {
    for (const item of orderBy) {
      if (item.type !== "column") {
        throw new Error("RANDOM() must be the only ORDER BY item");
      }
      const comparison = compareRowValues(left[item.expressionName], right[item.expressionName]);
      if (comparison !== 0) {
        return item.direction === "desc" ? -comparison : comparison;
      }
    }

    return 0;
  });
}

function paginateRows(
  rows: ReadonlyArray<SqlRow>,
  limit: number,
  offset: number,
): Readonly<{
  rows: ReadonlyArray<SqlRow>;
  hasMore: boolean;
}> {
  const pagedRows = rows.slice(offset, offset + limit);
  return {
    rows: pagedRows,
    hasMore: offset + pagedRows.length < rows.length,
  };
}

function expandRowsForSource(source: SqlFromSource, rows: ReadonlyArray<SqlRow>): ReadonlyArray<SqlRow> {
  if (source.unnestAlias === null || source.unnestColumnName === null) {
    return rows;
  }

  const unnestColumnName = source.unnestColumnName;
  return rows.flatMap((row) => normalizeStringArray(row[unnestColumnName]).map((value) => ({
    ...row,
    [source.unnestAlias as string]: value,
  })));
}

function validateRowOrderBy(source: SqlFromSource, orderBy: ReadonlyArray<SqlSelectOrderBy>): void {
  const availableColumns = getSqlSourceColumnDescriptors(source);
  for (const item of orderBy) {
    if (item.type === "random") {
      continue;
    }
    const columnDescriptor = availableColumns[item.expressionName];
    if (columnDescriptor === undefined) {
      throw new Error(`Unknown ORDER BY target: ${item.expressionName}`);
    }

    if (columnDescriptor.sortable === false) {
      throw new Error(`Column is not sortable: ${item.expressionName}`);
    }
  }
}

function normalizeAggregateNumbers(rows: ReadonlyArray<SqlRow>, columnName: string): ReadonlyArray<number> {
  return rows.flatMap((row) => {
    const value = row[columnName];
    return typeof value === "number" ? [value] : [];
  });
}

function normalizeAggregateComparableValues(rows: ReadonlyArray<SqlRow>, columnName: string): ReadonlyArray<SqlRowScalar> {
  return rows.flatMap((row) => {
    const value = row[columnName];
    if (value === undefined || value === null) {
      return [];
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return [value];
    }

    return [];
  });
}

function validateAggregateSelect(statement: SqlSelectStatement): void {
  const availableColumns = getSqlSourceColumnDescriptors(statement.source);

  for (const groupColumn of statement.groupBy) {
    if (availableColumns[groupColumn] === undefined) {
      throw new Error(`Unknown GROUP BY column: ${groupColumn}`);
    }
  }

  const aggregateOutputNames = new Set<string>();
  for (const item of statement.selectItems) {
    if (item.type === "wildcard") {
      throw new Error("SELECT * cannot be mixed with aggregate projections");
    }

    if (item.type === "column") {
      if (statement.groupBy.includes(item.columnName) === false) {
        throw new Error(`Grouped SELECT must list ${item.columnName} in GROUP BY`);
      }
      aggregateOutputNames.add(item.alias ?? item.columnName);
      continue;
    }

    const outputName = item.alias ?? defaultAggregateAlias(item.functionName, item.columnName);
    aggregateOutputNames.add(outputName);
    if (item.functionName === "count") {
      continue;
    }

    const columnName = item.columnName ?? "";
    const columnDescriptor = availableColumns[columnName];
    if (columnDescriptor === undefined) {
      throw new Error(`Unknown aggregate column: ${columnName}`);
    }

    if (item.functionName === "avg" || item.functionName === "sum") {
      if (columnDescriptor.type !== "integer" && columnDescriptor.type !== "number") {
        throw new Error(`${item.functionName.toUpperCase()} only supports numeric columns`);
      }
    }
  }

  for (const item of statement.orderBy) {
    if (item.type === "random") {
      continue;
    }

    if (aggregateOutputNames.has(item.expressionName) || statement.groupBy.includes(item.expressionName)) {
      continue;
    }

    throw new Error(`Unknown ORDER BY target: ${item.expressionName}`);
  }
}

function groupRowsForAggregateSelect(
  rows: ReadonlyArray<SqlRow>,
  groupBy: ReadonlyArray<string>,
  shouldReturnSingleAggregateRow: boolean,
): ReadonlyArray<Readonly<{
  groupRow: SqlRow;
  groupedRows: ReadonlyArray<SqlRow>;
}>> {
  if (groupBy.length === 0) {
    if (rows.length === 0 && shouldReturnSingleAggregateRow === false) {
      return [];
    }

    return [{
      groupRow: {},
      groupedRows: rows,
    }];
  }

  const groups = new Map<string, Readonly<{
    groupRow: SqlRow;
    groupedRows: ReadonlyArray<SqlRow>;
  }>>();

  for (const row of rows) {
    const keyValues = groupBy.map((columnName) => row[columnName] ?? null);
    const key = JSON.stringify(keyValues);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        groupRow: Object.fromEntries(groupBy.map((columnName) => [columnName, row[columnName] ?? null] as const)),
        groupedRows: [row],
      });
      continue;
    }

    groups.set(key, {
      groupRow: existing.groupRow,
      groupedRows: [...existing.groupedRows, row],
    });
  }

  return [...groups.values()];
}

function buildAggregateOutputRow(
  groupRow: SqlRow,
  groupedRows: ReadonlyArray<SqlRow>,
  selectItems: ReadonlyArray<SqlSelectItem>,
): SqlRow {
  const outputEntries: Array<readonly [string, SqlRowValue]> = [];

  for (const item of selectItems) {
    if (item.type === "wildcard") {
      throw new Error("Aggregate SELECT cannot project *");
    }

    if (item.type === "column") {
      outputEntries.push([item.alias ?? item.columnName, groupRow[item.columnName] ?? null] as const);
      continue;
    }

    const outputName = item.alias ?? defaultAggregateAlias(item.functionName, item.columnName);
    if (item.functionName === "count") {
      outputEntries.push([outputName, groupedRows.length] as const);
      continue;
    }

    const columnName = item.columnName ?? "";
    if (item.functionName === "sum") {
      const values = normalizeAggregateNumbers(groupedRows, columnName);
      outputEntries.push([outputName, values.reduce((total, value) => total + value, 0)] as const);
      continue;
    }

    if (item.functionName === "avg") {
      const values = normalizeAggregateNumbers(groupedRows, columnName);
      outputEntries.push([outputName, values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length] as const);
      continue;
    }

    const comparableValues = normalizeAggregateComparableValues(groupedRows, columnName);
    if (comparableValues.length === 0) {
      outputEntries.push([outputName, null] as const);
      continue;
    }

    const sortedValues = [...comparableValues].sort((left, right) => compareRowValues(left, right));
    outputEntries.push([outputName, item.functionName === "min" ? sortedValues[0] ?? null : sortedValues.at(-1) ?? null] as const);
  }

  return Object.fromEntries(outputEntries);
}

function executeAggregateSelect(statement: SqlSelectStatement, rows: ReadonlyArray<SqlRow>): ReadonlyArray<SqlRow> {
  validateAggregateSelect(statement);
  const groups = groupRowsForAggregateSelect(
    rows,
    statement.groupBy,
    statement.selectItems.some((item) => item.type === "aggregate"),
  );
  const aggregateRows = groups.map(({ groupRow, groupedRows }) => buildAggregateOutputRow(groupRow, groupedRows, statement.selectItems));
  return applyOrderBy(aggregateRows, statement.orderBy);
}

function projectSelectRow(row: SqlRow, selectItems: ReadonlyArray<SqlSelectItem>): SqlRow {
  const outputEntries: Array<readonly [string, SqlRowValue]> = [];

  for (const item of selectItems) {
    if (item.type !== "column") {
      throw new Error("Projected SELECT can only include columns");
    }

    outputEntries.push([item.alias ?? item.columnName, row[item.columnName] ?? null] as const);
  }

  return Object.fromEntries(outputEntries);
}

function executeProjectedSelect(statement: SqlSelectStatement, rows: ReadonlyArray<SqlRow>): ReadonlyArray<SqlRow> {
  validateRowOrderBy(statement.source, statement.orderBy);
  const orderedRows = applyOrderBy(rows, statement.orderBy);
  return orderedRows.map((row) => projectSelectRow(row, statement.selectItems));
}

function isWildcardSelect(statement: SqlSelectStatement): boolean {
  return statement.selectItems.length === 1 && statement.selectItems[0]?.type === "wildcard";
}

function isGroupedSelect(statement: SqlSelectStatement): boolean {
  return statement.groupBy.length > 0 || statement.selectItems.some((item) => item.type === "aggregate");
}

/**
 * iOS mirror:
 * `apps/backend/src/aiTools/sqlDialectSelectExecutor.ts::executeSqlSelect`
 */
export function executeSqlSelect(
  statement: SqlSelectStatement,
  rows: ReadonlyArray<SqlRow>,
  maximumLimit: number,
): SqlSelectExecutionResult {
  const limit = normalizeSqlLimit(statement.limit, maximumLimit);
  const offset = normalizeSqlOffset(statement.offset);
  const expandedRows = expandRowsForSource(statement.source, rows);
  const filteredRows = applyPredicateClauses(statement.source, expandedRows, statement.predicateClauses);
  const orderedRows = isWildcardSelect(statement)
    ? (() => {
      validateRowOrderBy(statement.source, statement.orderBy);
      return applyOrderBy(filteredRows, statement.orderBy);
    })()
    : isGroupedSelect(statement)
      ? executeAggregateSelect(statement, filteredRows)
      : executeProjectedSelect(statement, filteredRows);
  const paginatedRows = paginateRows(orderedRows, limit, offset);

  return {
    rows: paginatedRows.rows,
    rowCount: paginatedRows.rows.length,
    limit,
    offset,
    hasMore: paginatedRows.hasMore,
  };
}
