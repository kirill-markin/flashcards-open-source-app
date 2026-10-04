import type { ReactNode } from "react";

// The pure half of `DataTable`: column definitions, the controlled state, and the sort, filter, page
// and URL operations over it. The sort, filter and page operations run client-side over rows already
// loaded; `dataTableSql.ts` applies the same state in SQL for the server mode.

export type DataTableColumnKind = "text" | "number" | "date" | "enum" | "boolean";

type DataTableColumnBase<Row> = Readonly<{
  id: string;
  label: string;
  /** Replaces the default cell text; sorting and filtering still read `value`. */
  renderCell: ((row: Row) => ReactNode) | null;
}>;

export type DataTableColumn<Row> =
  | DataTableColumnBase<Row> & Readonly<{ kind: "text"; value: (row: Row) => string | null }>
  | DataTableColumnBase<Row> & Readonly<{ kind: "number"; value: (row: Row) => number | null }>
  /** An ISO-8601 UTC instant (`...Z`), so instants sort as strings and their first ten characters are the UTC date. */
  | DataTableColumnBase<Row> & Readonly<{ kind: "date"; value: (row: Row) => string | null }>
  | DataTableColumnBase<Row> & Readonly<{ kind: "enum"; value: (row: Row) => string | null }>
  | DataTableColumnBase<Row> & Readonly<{ kind: "boolean"; value: (row: Row) => boolean | null }>;

export type DataTableFilter =
  | Readonly<{ kind: "text"; contains: string }>
  | Readonly<{ kind: "number"; min: number | null; max: number | null }>
  /** Inclusive `YYYY-MM-DD` UTC dates. */
  | Readonly<{ kind: "date"; from: string | null; to: string | null }>
  /** A NULL value is offered and matched as `""`. */
  | Readonly<{ kind: "enum"; values: ReadonlyArray<string> }>
  | Readonly<{ kind: "boolean"; value: boolean }>;

export type DataTableSort = Readonly<{ columnId: string; direction: "asc" | "desc" }> | null;

export type DataTableState = Readonly<{
  sort: DataTableSort;
  /** Keyed by column id; a column without an entry is unfiltered. */
  filters: Readonly<Record<string, DataTableFilter>>;
  /** Zero-based; may point past the last page, which `getDataTablePage` clamps. */
  page: number;
}>;

export const emptyDataTableState: DataTableState = { sort: null, filters: {}, page: 0 };

/**
 * Server mode: a query already sorted, filtered and paged `rows` to the page at `state.page`, which
 * the caller clamps to the last page of `totalCount`.
 */
export type DataTableServerPage = Readonly<{
  /** The rows matching the filters across every page. */
  totalCount: number;
  /** Every enum column's full option list, since one page cannot show every value; NULL is `""`. */
  enumOptionsByColumnId: ReadonlyMap<string, ReadonlyArray<string>>;
  isLoading: boolean;
}>;

export const dataTablePageSize = 100;

const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

const textCollator = new Intl.Collator("en-US");

/** A filter whose every input is empty filters nothing, so it is dropped rather than stored. */
export function isDataTableFilterActive(filter: DataTableFilter): boolean {
  switch (filter.kind) {
    case "text":
      return filter.contains.trim() !== "";
    case "number":
      return filter.min !== null || filter.max !== null;
    case "date":
      return filter.from !== null || filter.to !== null;
    case "enum":
      return filter.values.length > 0;
    case "boolean":
      return true;
  }
}

function matchesFilter<Row>(column: DataTableColumn<Row>, filter: DataTableFilter, row: Row): boolean {
  if (column.kind === "text" && filter.kind === "text") {
    return (column.value(row) ?? "").toLowerCase().includes(filter.contains.trim().toLowerCase());
  }
  if (column.kind === "number" && filter.kind === "number") {
    const value = column.value(row);
    return value !== null
      && (filter.min === null || value >= filter.min)
      && (filter.max === null || value <= filter.max);
  }
  if (column.kind === "date" && filter.kind === "date") {
    const value = column.value(row);
    const date = value === null ? null : value.slice(0, 10);
    return date !== null
      && (filter.from === null || date >= filter.from)
      && (filter.to === null || date <= filter.to);
  }
  if (column.kind === "enum" && filter.kind === "enum") {
    return filter.values.includes(column.value(row) ?? "");
  }
  if (column.kind === "boolean" && filter.kind === "boolean") {
    return column.value(row) === filter.value;
  }
  throw new Error(`Data table filter kind "${filter.kind}" does not match column "${column.id}" of kind "${column.kind}".`);
}

function compareValues<Row>(column: DataTableColumn<Row>, left: Row, right: Row): number {
  const leftValue = column.value(left);
  const rightValue = column.value(right);
  if (leftValue === null || rightValue === null) {
    return leftValue === rightValue ? 0 : leftValue === null ? 1 : -1;
  }
  if (typeof leftValue === "string" && typeof rightValue === "string") {
    return column.kind === "date"
      ? (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0)
      : textCollator.compare(leftValue, rightValue);
  }
  return Number(leftValue) - Number(rightValue);
}

/** Filters, then sorts stably; empty values stay last in either direction. */
export function filterAndSortDataTableRows<Row>(
  rows: ReadonlyArray<Row>,
  columns: ReadonlyArray<DataTableColumn<Row>>,
  filters: DataTableState["filters"],
  sort: DataTableSort,
): ReadonlyArray<Row> {
  const activeFilters = columns.flatMap((column) => {
    const filter = filters[column.id];
    return filter === undefined ? [] : [{ column, filter }];
  });
  const filteredRows = rows.filter((row) => activeFilters.every(({ column, filter }) => matchesFilter(column, filter, row)));
  const sortColumn = sort === null ? undefined : columns.find((column) => column.id === sort.columnId);
  if (sort === null || sortColumn === undefined) {
    return filteredRows;
  }

  const direction = sort.direction === "asc" ? 1 : -1;
  return [...filteredRows].sort((left, right) => {
    const comparison = compareValues(sortColumn, left, right);
    const isNullComparison = sortColumn.value(left) === null || sortColumn.value(right) === null;
    return isNullComparison ? comparison : comparison * direction;
  });
}

export function getDataTablePageCount(rowCount: number): number {
  return Math.max(1, Math.ceil(rowCount / dataTablePageSize));
}

export function clampDataTablePage(page: number, rowCount: number): number {
  return Math.min(Math.max(0, page), getDataTablePageCount(rowCount) - 1);
}

export function getDataTablePage<Row>(rows: ReadonlyArray<Row>, page: number): Readonly<{
  page: number;
  rows: ReadonlyArray<Row>;
}> {
  const clampedPage = clampDataTablePage(page, rows.length);
  return {
    page: clampedPage,
    rows: rows.slice(clampedPage * dataTablePageSize, (clampedPage + 1) * dataTablePageSize),
  };
}

/** Header click cycle: ascending, descending, then unsorted. */
export function getNextDataTableSort(sort: DataTableSort, columnId: string): DataTableSort {
  if (sort === null || sort.columnId !== columnId) {
    return { columnId, direction: "asc" };
  }
  return sort.direction === "asc" ? { columnId, direction: "desc" } : null;
}

/** Sets or clears one column's filter; any filter change returns to the first page. */
export function withDataTableFilter(
  state: DataTableState,
  columnId: string,
  filter: DataTableFilter | null,
): DataTableState {
  const filters = Object.fromEntries(Object.entries(state.filters).filter(([id]) => id !== columnId));
  return {
    ...state,
    filters: filter === null || !isDataTableFilterActive(filter) ? filters : { ...filters, [columnId]: filter },
    page: 0,
  };
}

// URL codec. Every parameter carries the caller's prefix, so a page can host more than one table or
// keep its own parameters beside one: `sort` is `<column>` or `-<column>`, `page` is one-based, and a
// filter is `f.<column>` - text as typed, number and date as `<min>..<max>` with either side empty,
// enum as one repeated parameter per value, boolean as `yes` or `no`. Anything malformed or naming
// an unknown column is ignored, so a hand-edited link opens on the unfiltered default instead.

function parseRangeBound(value: string): string | null {
  return value === "" ? null : value;
}

function parseFilter<Row>(column: DataTableColumn<Row>, values: ReadonlyArray<string>): DataTableFilter | null {
  const value = values[0];
  if (value === undefined) {
    return null;
  }
  switch (column.kind) {
    case "text":
      return { kind: "text", contains: value };
    case "enum":
      return { kind: "enum", values: [...new Set(values)] };
    case "boolean":
      return value === "yes" || value === "no" ? { kind: "boolean", value: value === "yes" } : null;
    case "number": {
      const bounds = value.split("..");
      if (bounds.length !== 2) {
        return null;
      }
      const [min, max] = bounds.map((bound) => {
        const parsed = parseRangeBound(bound);
        return parsed === null ? null : Number(parsed);
      });
      return Number.isNaN(min) || Number.isNaN(max) ? null : { kind: "number", min: min ?? null, max: max ?? null };
    }
    case "date": {
      const bounds = value.split("..");
      if (bounds.length !== 2 || bounds.some((bound) => bound !== "" && !calendarDatePattern.test(bound))) {
        return null;
      }
      return { kind: "date", from: parseRangeBound(bounds[0] ?? ""), to: parseRangeBound(bounds[1] ?? "") };
    }
  }
}

export function parseDataTableState<Row>(
  searchParams: URLSearchParams,
  columns: ReadonlyArray<DataTableColumn<Row>>,
  paramPrefix: string,
): DataTableState {
  const sortParam = searchParams.get(`${paramPrefix}sort`) ?? "";
  const sortColumnId = sortParam.replace(/^-/u, "");
  const sort: DataTableSort = columns.some((column) => column.id === sortColumnId)
    ? { columnId: sortColumnId, direction: sortParam.startsWith("-") ? "desc" : "asc" }
    : null;
  const filters: Record<string, DataTableFilter> = {};
  for (const column of columns) {
    const filter = parseFilter(column, searchParams.getAll(`${paramPrefix}f.${column.id}`));
    if (filter !== null && isDataTableFilterActive(filter)) {
      filters[column.id] = filter;
    }
  }
  const page = Number(searchParams.get(`${paramPrefix}page`) ?? "1");
  return { sort, filters, page: Number.isSafeInteger(page) && page > 1 ? page - 1 : 0 };
}

function formatRangeBound(value: number | string | null): string {
  return value === null ? "" : String(value);
}

/** Only the table's own parameters, in column order; the caller merges them into its URL. */
export function toDataTableSearchParams<Row>(
  state: DataTableState,
  columns: ReadonlyArray<DataTableColumn<Row>>,
  paramPrefix: string,
): URLSearchParams {
  const searchParams = new URLSearchParams();
  if (state.sort !== null) {
    searchParams.set(`${paramPrefix}sort`, `${state.sort.direction === "desc" ? "-" : ""}${state.sort.columnId}`);
  }
  for (const column of columns) {
    const filter = state.filters[column.id];
    if (filter === undefined) {
      continue;
    }
    const key = `${paramPrefix}f.${column.id}`;
    switch (filter.kind) {
      case "text":
        searchParams.set(key, filter.contains);
        break;
      case "number":
        searchParams.set(key, `${formatRangeBound(filter.min)}..${formatRangeBound(filter.max)}`);
        break;
      case "date":
        searchParams.set(key, `${formatRangeBound(filter.from)}..${formatRangeBound(filter.to)}`);
        break;
      case "enum":
        filter.values.forEach((value) => searchParams.append(key, value));
        break;
      case "boolean":
        searchParams.set(key, filter.value ? "yes" : "no");
        break;
    }
  }
  if (state.page > 0) {
    searchParams.set(`${paramPrefix}page`, String(state.page + 1));
  }
  return searchParams;
}
