import type { AdminQueryObject, AdminQueryResponse, AdminQueryValue } from "../adminApi";

// Query helpers shared by the `DataTable` server-mode lists: the row columns they select and the enum
// filter options they load.

/** Each entry as `<sql> AS "<name>"`, so a row is read by the name its parser asks for. */
export function buildNamedColumnsSql(sqlByName: Readonly<Record<string, string>>): ReadonlyArray<string> {
  return Object.entries(sqlByName).map(([name, sqlExpression]) => `${sqlExpression} AS "${name}"`);
}

/** The total a page statement returns beside its rows. */
export function parsePageTotal(value: AdminQueryValue | undefined, reportLabel: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${reportLabel} total must be a non-negative integer.`);
  }
  return value;
}

export function buildDistinctOptionsSql(valueSql: string): string {
  return `COALESCE(json_agg(DISTINCT ${valueSql} ORDER BY ${valueSql}), '[]'::json)`;
}

export function isObjectValue(value: AdminQueryValue | undefined): value is AdminQueryObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOptionList(value: AdminQueryValue | undefined, columnId: string, reportLabel: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    throw new Error(`${reportLabel} options for column "${columnId}" must be an array.`);
  }
  const options: ReadonlyArray<AdminQueryValue> = value;
  return options.map((option, index) => {
    if (typeof option !== "string") {
      throw new Error(`${reportLabel} option ${index} of column "${columnId}" must be a string.`);
    }
    return option;
  });
}

/** Every column in `columnIds` with no options, which a table shows until its options query answers. */
export function emptyEnumOptions(columnIds: ReadonlyArray<string>): ReadonlyMap<string, ReadonlyArray<string>> {
  return new Map(columnIds.map((columnId) => [columnId, []] as const));
}

/** The options of every column in `columnIds`, from a response whose one row holds an `o` object keyed by column id. */
export function parseEnumOptionsResponse(
  response: AdminQueryResponse,
  columnIds: ReadonlyArray<string>,
  reportLabel: string,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const optionsValue = response.resultSets[0]?.rows[0]?.o;
  if (response.resultSets.length !== 1 || !isObjectValue(optionsValue)) {
    throw new Error(`${reportLabel} options query must return exactly one result set with one object row.`);
  }
  return new Map(columnIds.map((columnId) => [columnId, parseOptionList(optionsValue[columnId], columnId, reportLabel)] as const));
}
