import { escapeSqlStringLiteral } from "../sql";
import {
  dataTablePageSize,
  isDataTableFilterActive,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableState,
} from "./dataTableModel";

// The server half of `DataTable`: the same state applied in SQL rather than over loaded rows, with the
// client match and sort semantics of `dataTableModel.ts`.

export type DataTableSqlClauses = Readonly<{
  /** A boolean expression without the `WHERE` keyword, `TRUE` when nothing is filtered. */
  whereConditionSql: string;
  orderBySql: string;
  limitOffsetSql: string;
}>;

/** Parenthesized, so an operator inside the caller's expression cannot bind to the clause around it. */
function requireColumnSql(columnSqlById: Readonly<Record<string, string>>, columnId: string): string {
  const sqlExpression = columnSqlById[columnId];
  if (sqlExpression === undefined) {
    throw new Error(`Data table column "${columnId}" has no SQL expression.`);
  }
  return `(${sqlExpression})`;
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function formatNumberBound(columnId: string, value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Data table number filter on column "${columnId}" has a non-finite bound: ${value}.`);
  }
  return String(value);
}

/** Every `""` selected also matches NULL, as `matchesFilter` reads a NULL value as `""`. */
function buildEnumConditionSql(sqlExpression: string, values: ReadonlyArray<string>): string {
  const inSql = `${sqlExpression} IN (${values.map(escapeSqlStringLiteral).join(", ")})`;
  return values.includes("") ? `${inSql} OR ${sqlExpression} IS NULL` : inSql;
}

function buildFilterConditionSql<Row>(column: DataTableColumn<Row>, filter: DataTableFilter, sqlExpression: string): string {
  if (column.kind === "text" && filter.kind === "text") {
    const pattern = `%${escapeLikePattern(filter.contains.trim())}%`;
    return `${sqlExpression} ILIKE ${escapeSqlStringLiteral(pattern)} ESCAPE '\\'`;
  }
  if (column.kind === "number" && filter.kind === "number") {
    return [
      filter.min === null ? null : `${sqlExpression} >= ${formatNumberBound(column.id, filter.min)}`,
      filter.max === null ? null : `${sqlExpression} <= ${formatNumberBound(column.id, filter.max)}`,
    ].filter((condition) => condition !== null).join(" AND ");
  }
  // A half-open range of UTC instants rather than a cast of the column, so an index on it stays usable.
  if (column.kind === "date" && filter.kind === "date") {
    return [
      filter.from === null
        ? null
        : `${sqlExpression} >= ((${escapeSqlStringLiteral(filter.from)}::date)::timestamp AT TIME ZONE 'UTC')`,
      filter.to === null
        ? null
        : `${sqlExpression} < ((${escapeSqlStringLiteral(filter.to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')`,
    ].filter((condition) => condition !== null).join(" AND ");
  }
  if (column.kind === "enum" && filter.kind === "enum") {
    return buildEnumConditionSql(sqlExpression, filter.values);
  }
  if (column.kind === "boolean" && filter.kind === "boolean") {
    return `${sqlExpression} IS ${filter.value ? "TRUE" : "FALSE"}`;
  }
  throw new Error(`Data table filter kind "${filter.kind}" does not match column "${column.id}" of kind "${column.kind}".`);
}

/**
 * `columnSqlById` maps a column id to the SQL expression its filter and sort read; a date column's
 * expression must be a `timestamptz`. `defaultOrderBySql` orders an unsorted table, and
 * `tiebreakOrderBySql` is a unique key with its direction, appended to every order so pages are stable.
 */
export function buildDataTableSqlClauses<Row>(
  state: DataTableState,
  columns: ReadonlyArray<DataTableColumn<Row>>,
  columnSqlById: Readonly<Record<string, string>>,
  defaultOrderBySql: string,
  tiebreakOrderBySql: string,
): DataTableSqlClauses {
  // Every column up front, so a missing expression fails the first query rather than the first click.
  columns.forEach((column) => {
    if (column.kind === "enum-list") {
      throw new Error(`Data table column "${column.id}" is an enum list, which server mode does not support.`);
    }
    requireColumnSql(columnSqlById, column.id);
  });
  if (!Number.isSafeInteger(state.page) || state.page < 0) {
    throw new Error(`Data table page must be a non-negative integer, got ${state.page}.`);
  }
  const conditions = columns.flatMap((column) => {
    const filter = state.filters[column.id];
    return filter === undefined || !isDataTableFilterActive(filter)
      ? []
      : [`(${buildFilterConditionSql(column, filter, requireColumnSql(columnSqlById, column.id))})`];
  });
  const sortSql = state.sort === null
    ? defaultOrderBySql
    : `${requireColumnSql(columnSqlById, state.sort.columnId)} ${state.sort.direction === "asc" ? "ASC" : "DESC"} NULLS LAST`;
  return {
    whereConditionSql: conditions.length === 0 ? "TRUE" : conditions.join(" AND "),
    orderBySql: `ORDER BY ${sortSql}, ${tiebreakOrderBySql}`,
    limitOffsetSql: `LIMIT ${dataTablePageSize} OFFSET ${state.page * dataTablePageSize}`,
  };
}
