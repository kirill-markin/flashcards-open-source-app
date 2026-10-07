import { useMemo, type ChangeEvent, type JSX, type ReactNode } from "react";
import {
  clampDataTablePage,
  filterAndSortDataTableRows,
  getDataTablePage,
  getDataTablePageCount,
  getNextDataTableSort,
  withDataTableFilter,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableServerPage,
  type DataTableState,
} from "./dataTableModel";
import "./dataTable.css";

const emptyEnumOptionLabel = "(empty)";

function formatDefaultCell<Row>(column: DataTableColumn<Row>, row: Row): string {
  switch (column.kind) {
    case "number": {
      const value = column.value(row);
      return value === null ? "" : value.toLocaleString("en-US");
    }
    case "date": {
      const value = column.value(row);
      return value === null ? "" : `${value.slice(0, 10)} ${value.slice(11, 16)}`;
    }
    case "boolean": {
      const value = column.value(row);
      return value === null ? "" : value ? "yes" : "no";
    }
    case "text":
    case "enum":
      return column.value(row) ?? "";
    case "enum-list":
      return column.value(row).join(", ");
  }
}

/**
 * The values present in the rows, offered as the column's multi-select; a list offers each of its
 * values, and NULL or an empty list is offered as `""`.
 */
function getEnumOptions<Row>(column: DataTableColumn<Row>, rows: ReadonlyArray<Row>): ReadonlyArray<string> {
  if (column.kind === "enum-list") {
    const readValues = column.value;
    const values = new Set(rows.flatMap((row) => {
      const rowValues = readValues(row);
      return rowValues.length === 0 ? [""] : rowValues;
    }));
    return [...values].sort();
  }
  if (column.kind !== "enum") {
    return [];
  }
  const readValue = column.value;
  const values = new Set(rows.map((row) => readValue(row) ?? ""));
  return [...values].sort();
}

function getServerEnumOptions<Row>(column: DataTableColumn<Row>, server: DataTableServerPage): ReadonlyArray<string> {
  if (column.kind !== "enum") {
    return [];
  }
  const options = server.enumOptionsByColumnId.get(column.id);
  if (options === undefined) {
    throw new Error(`Server-mode data table has no enum options for column "${column.id}".`);
  }
  return options;
}

function parseNumberInput(value: string): number | null {
  return value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
}

function parseDateInput(value: string): string | null {
  return value === "" ? null : value;
}

function EnumFilter(props: Readonly<{
  testId: string;
  label: string;
  options: ReadonlyArray<string>;
  selected: ReadonlyArray<string>;
  onChange: (values: ReadonlyArray<string>) => void;
}>): JSX.Element {
  function toggle(option: string, isChecked: boolean): void {
    props.onChange(isChecked
      ? props.options.filter((candidate) => candidate === option || props.selected.includes(candidate))
      : props.selected.filter((candidate) => candidate !== option));
  }

  return (
    <details className="data-table-enum-filter" data-testid={props.testId}>
      <summary aria-label={`Filter ${props.label}`}>{props.selected.length === 0 ? "Any" : `${props.selected.length} selected`}</summary>
      <div className="data-table-enum-options">
        {props.options.map((option) => (
          <label key={option} className="data-table-enum-option">
            <input
              type="checkbox"
              checked={props.selected.includes(option)}
              onChange={(event) => toggle(option, event.target.checked)}
            />
            <span>{option === "" ? emptyEnumOptionLabel : option}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function ColumnFilter<Row>(props: Readonly<{
  testId: string;
  column: DataTableColumn<Row>;
  filter: DataTableFilter | undefined;
  enumOptions: ReadonlyArray<string>;
  onChange: (filter: DataTableFilter | null) => void;
}>): JSX.Element {
  const column = props.column;
  const filter = props.filter;
  const label = column.label;

  switch (column.kind) {
    case "text":
      return (
        <input
          className="data-table-filter-input"
          type="search"
          aria-label={`Filter ${label}`}
          placeholder="Contains"
          data-testid={props.testId}
          value={filter?.kind === "text" ? filter.contains : ""}
          onChange={(event: ChangeEvent<HTMLInputElement>) => props.onChange({ kind: "text", contains: event.target.value })}
        />
      );
    case "number": {
      const range = filter?.kind === "number" ? filter : { kind: "number" as const, min: null, max: null };
      return (
        <div className="data-table-filter-range" data-testid={props.testId}>
          <input className="data-table-filter-input" type="number" aria-label={`${label} minimum`} placeholder="Min"
            value={range.min ?? ""} onChange={(event) => props.onChange({ ...range, min: parseNumberInput(event.target.value) })} />
          <input className="data-table-filter-input" type="number" aria-label={`${label} maximum`} placeholder="Max"
            value={range.max ?? ""} onChange={(event) => props.onChange({ ...range, max: parseNumberInput(event.target.value) })} />
        </div>
      );
    }
    case "date": {
      const range = filter?.kind === "date" ? filter : { kind: "date" as const, from: null, to: null };
      return (
        <div className="data-table-filter-range" data-testid={props.testId}>
          <input className="data-table-filter-input" type="date" aria-label={`${label} from (UTC)`}
            value={range.from ?? ""} onChange={(event) => props.onChange({ ...range, from: parseDateInput(event.target.value) })} />
          <input className="data-table-filter-input" type="date" aria-label={`${label} to (UTC)`}
            value={range.to ?? ""} onChange={(event) => props.onChange({ ...range, to: parseDateInput(event.target.value) })} />
        </div>
      );
    }
    case "enum":
    case "enum-list":
      return (
        <EnumFilter
          testId={props.testId}
          label={label}
          options={props.enumOptions}
          selected={filter?.kind === "enum" ? filter.values : []}
          onChange={(values) => props.onChange({ kind: "enum", values })}
        />
      );
    case "boolean":
      return (
        <select
          className="data-table-filter-input"
          aria-label={`Filter ${label}`}
          data-testid={props.testId}
          value={filter?.kind === "boolean" ? (filter.value ? "yes" : "no") : "any"}
          onChange={(event) => props.onChange(event.target.value === "any"
            ? null
            : { kind: "boolean", value: event.target.value === "yes" })}
        >
          <option value="any">Any</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      );
  }
}

/**
 * Header click sorts, the second header row filters per column, and the state is controlled so the
 * caller can keep it in its URL. With `server` null the table sorts, filters and pages every loaded
 * row itself; otherwise the caller applies `state` in a query and passes one page.
 */
export function DataTable<Row>(props: Readonly<{
  testId: string;
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row) => string;
  /** Marks a row with a modifier class, for rows shown but not counted elsewhere. */
  rowClassName: (row: Row) => string;
  state: DataTableState;
  onStateChange: (state: DataTableState) => void;
  server: DataTableServerPage | null;
}>): JSX.Element {
  const { columns, rows, state, onStateChange, testId, server } = props;
  // Keyed on the filters and the sort alone, so turning a page does not filter and sort again.
  const visibleRows = useMemo(
    () => server === null ? filterAndSortDataTableRows(rows, columns, state.filters, state.sort) : rows,
    [columns, rows, server, state.filters, state.sort],
  );
  const enumOptionsByColumnId = useMemo(
    () => new Map(columns.map((column) => [
      column.id,
      server === null ? getEnumOptions(column, rows) : getServerEnumOptions(column, server),
    ] as const)),
    [columns, rows, server],
  );
  const pageCount = getDataTablePageCount(server === null ? visibleRows.length : server.totalCount);
  const page = server === null
    ? getDataTablePage(visibleRows, state.page)
    : { page: clampDataTablePage(state.page, server.totalCount), rows };
  const isLoading = server !== null && server.isLoading;
  const hasFilters = Object.keys(state.filters).length > 0;

  function renderCell(column: DataTableColumn<Row>, row: Row): ReactNode {
    return column.renderCell === null ? formatDefaultCell(column, row) : column.renderCell(row);
  }

  return (
    <div className="data-table" data-testid={testId} aria-busy={server === null ? undefined : isLoading}>
      <div className="data-table-toolbar">
        <span className="data-table-count" data-testid={`${testId}-row-count`}>
          {server === null
            ? `${visibleRows.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows`
            : `${server.totalCount.toLocaleString("en-US")} rows`}
        </span>
        {server === null ? null : (
          <span className={`data-table-loading${isLoading ? " active" : ""}`} data-testid={`${testId}-loading`}>Updating</span>
        )}
        <button
          className="filter-button filter-button-compact"
          type="button"
          disabled={!hasFilters}
          data-testid={`${testId}-clear-filters`}
          onClick={() => onStateChange({ ...state, filters: {}, page: 0 })}
        >Clear all filters</button>
        <div className="data-table-pager">
          <button className="filter-button filter-button-compact" type="button" disabled={page.page === 0}
            data-testid={`${testId}-page-previous`} onClick={() => onStateChange({ ...state, page: page.page - 1 })}>Previous</button>
          <span data-testid={`${testId}-page-status`}>Page {page.page + 1} of {pageCount}</span>
          <button className="filter-button filter-button-compact" type="button" disabled={page.page >= pageCount - 1}
            data-testid={`${testId}-page-next`} onClick={() => onStateChange({ ...state, page: page.page + 1 })}>Next</button>
        </div>
      </div>
      <div className="data-table-scroll">
        <table className="data-table-grid">
          <thead>
            <tr>
              {columns.map((column) => {
                const direction = state.sort?.columnId === column.id ? state.sort.direction : null;
                return (
                  <th key={column.id} scope="col" aria-sort={direction === null ? "none" : direction === "asc" ? "ascending" : "descending"}>
                    <button
                      className="data-table-sort-button"
                      type="button"
                      data-testid={`${testId}-sort-${column.id}`}
                      onClick={() => onStateChange({ ...state, sort: getNextDataTableSort(state.sort, column.id), page: 0 })}
                    >
                      {column.label}
                      <span aria-hidden="true">{direction === "asc" ? " ▲" : direction === "desc" ? " ▼" : ""}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
            <tr className="data-table-filter-row">
              {columns.map((column) => (
                <th key={column.id} scope="col">
                  <ColumnFilter
                    testId={`${testId}-filter-${column.id}`}
                    column={column}
                    filter={state.filters[column.id]}
                    enumOptions={enumOptionsByColumnId.get(column.id) ?? []}
                    onChange={(filter) => onStateChange(withDataTableFilter(state, column.id, filter))}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={props.rowKey(row)} className={props.rowClassName(row)} data-testid={`${testId}-row`}>
                {columns.map((column) => (
                  <td key={column.id} className={column.kind === "number" ? "data-table-number" : undefined}>{renderCell(column, row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {page.rows.length === 0 && !isLoading ? <p className="data-table-empty" data-testid={`${testId}-empty`}>No rows match these filters.</p> : null}
      </div>
    </div>
  );
}
