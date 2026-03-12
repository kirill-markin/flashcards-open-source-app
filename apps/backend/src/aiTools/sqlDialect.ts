export type SqlResourceName =
  | "workspace"
  | "cards"
  | "decks"
  | "review_events";

export type SqlOrderDirection = "asc" | "desc";

export type SqlColumnType =
  | "string"
  | "string[]"
  | "integer[]"
  | "uuid"
  | "integer"
  | "number"
  | "boolean"
  | "datetime";

export type SqlColumnDescriptor = Readonly<{
  columnName: string;
  type: SqlColumnType;
  nullable: boolean;
  readOnly: boolean;
  filterable: boolean;
  sortable: boolean;
  description: string;
}>;

export type SqlResourceDescriptor = Readonly<{
  resourceName: SqlResourceName;
  description: string;
  columns: ReadonlyArray<SqlColumnDescriptor>;
  writable: boolean;
}>;

export type SqlLiteral = string | number | boolean | null;
export type SqlPredicateValue = SqlLiteral | Readonly<{ type: "now" }>;
export type SqlRowScalar = string | number | boolean | null;
export type SqlRowValue = SqlRowScalar | ReadonlyArray<string> | ReadonlyArray<number>;
export type SqlRow = Readonly<Record<string, SqlRowValue>>;
export type SqlComparisonOperator = "=" | "<" | "<=" | ">" | ">=";

export type SqlPredicate =
  | Readonly<{
    type: "comparison";
    columnName: string;
    operator: SqlComparisonOperator;
    value: SqlPredicateValue;
  }>
  | Readonly<{
    type: "in";
    columnName: string;
    values: ReadonlyArray<SqlLiteral>;
  }>
  | Readonly<{
    type: "overlap";
    columnName: string;
    values: ReadonlyArray<string>;
  }>
  | Readonly<{
    type: "is_null";
    columnName: string;
  }>
  | Readonly<{
    type: "is_not_null";
    columnName: string;
  }>
  | Readonly<{
    type: "match";
    query: string;
  }>;

export type SqlPredicateClause = ReadonlyArray<SqlPredicate>;

export type SqlSelectOrderBy = Readonly<{
  expressionName: string;
  direction: SqlOrderDirection;
}>;

export type SqlAggregateFunctionName = "count" | "sum" | "avg" | "min" | "max";

export type SqlSelectItem =
  | Readonly<{
    type: "wildcard";
  }>
  | Readonly<{
    type: "column";
    columnName: string;
    alias: string | null;
  }>
  | Readonly<{
    type: "aggregate";
    functionName: SqlAggregateFunctionName;
    columnName: string | null;
    alias: string | null;
  }>;

export type SqlFromSource = Readonly<{
  resourceName: SqlResourceName;
  unnestColumnName: "tags" | null;
  unnestAlias: string | null;
}>;

export type SqlSelectStatement = Readonly<{
  type: "select";
  source: SqlFromSource;
  selectItems: ReadonlyArray<SqlSelectItem>;
  predicateClauses: ReadonlyArray<SqlPredicateClause>;
  groupBy: ReadonlyArray<string>;
  orderBy: ReadonlyArray<SqlSelectOrderBy>;
  limit: number | null;
  offset: number | null;
  normalizedSql: string;
}>;

export type SqlShowTablesStatement = Readonly<{
  type: "show_tables";
  likePattern: string | null;
  normalizedSql: string;
}>;

export type SqlDescribeStatement = Readonly<{
  type: "describe";
  resourceName: SqlResourceName;
  normalizedSql: string;
}>;

export type SqlInsertStatement = Readonly<{
  type: "insert";
  resourceName: "cards" | "decks";
  columnNames: ReadonlyArray<string>;
  rows: ReadonlyArray<ReadonlyArray<SqlLiteral | ReadonlyArray<string>>>;
  normalizedSql: string;
}>;

export type SqlUpdateStatement = Readonly<{
  type: "update";
  resourceName: "cards" | "decks";
  assignments: ReadonlyArray<Readonly<{
    columnName: string;
    value: SqlLiteral | ReadonlyArray<string>;
  }>>;
  predicateClauses: ReadonlyArray<SqlPredicateClause>;
  normalizedSql: string;
}>;

export type SqlDeleteStatement = Readonly<{
  type: "delete";
  resourceName: "cards" | "decks";
  predicateClauses: ReadonlyArray<SqlPredicateClause>;
  normalizedSql: string;
}>;

export type ParsedSqlStatement =
  | SqlShowTablesStatement
  | SqlDescribeStatement
  | SqlSelectStatement
  | SqlInsertStatement
  | SqlUpdateStatement
  | SqlDeleteStatement;

export type SqlSelectExecutionResult = Readonly<{
  rows: ReadonlyArray<SqlRow>;
  rowCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}>;

const cardColumnDescriptors: ReadonlyArray<SqlColumnDescriptor> = Object.freeze([
  {
    columnName: "card_id",
    type: "uuid",
    nullable: false,
    readOnly: true,
    filterable: true,
    sortable: true,
    description: "Card identifier.",
  },
  {
    columnName: "front_text",
    type: "string",
    nullable: false,
    readOnly: false,
    filterable: true,
    sortable: true,
    description: "Card front prompt text.",
  },
  {
    columnName: "back_text",
    type: "string",
    nullable: false,
    readOnly: false,
    filterable: true,
    sortable: true,
    description: "Card back answer text.",
  },
  {
    columnName: "tags",
    type: "string[]",
    nullable: false,
    readOnly: false,
    filterable: true,
    sortable: true,
    description: "Card tags.",
  },
  {
    columnName: "effort_level",
    type: "string",
    nullable: false,
    readOnly: false,
    filterable: true,
    sortable: true,
    description: "Card effort level.",
  },
  {
    columnName: "due_at",
    type: "datetime",
    nullable: true,
    readOnly: true,
    filterable: true,
    sortable: true,
    description: "Next due timestamp.",
  },
  {
    columnName: "reps",
    type: "integer",
    nullable: false,
    readOnly: true,
    filterable: true,
    sortable: true,
    description: "Total reps count.",
  },
  {
    columnName: "lapses",
    type: "integer",
    nullable: false,
    readOnly: true,
    filterable: true,
    sortable: true,
    description: "Total lapses count.",
  },
  {
    columnName: "updated_at",
    type: "datetime",
    nullable: false,
    readOnly: true,
    filterable: true,
    sortable: true,
    description: "Last update timestamp.",
  },
  {
    columnName: "deleted_at",
    type: "datetime",
    nullable: true,
    readOnly: true,
    filterable: false,
    sortable: false,
    description: "Deletion timestamp for tombstones.",
  },
  {
    columnName: "fsrs_card_state",
    type: "string",
    nullable: false,
    readOnly: true,
    filterable: true,
    sortable: false,
    description: "Persisted FSRS state.",
  },
  {
    columnName: "fsrs_step_index",
    type: "integer",
    nullable: true,
    readOnly: true,
    filterable: false,
    sortable: false,
    description: "Persisted FSRS step index.",
  },
  {
    columnName: "fsrs_stability",
    type: "number",
    nullable: true,
    readOnly: true,
    filterable: false,
    sortable: false,
    description: "Persisted FSRS stability.",
  },
  {
    columnName: "fsrs_difficulty",
    type: "number",
    nullable: true,
    readOnly: true,
    filterable: false,
    sortable: false,
    description: "Persisted FSRS difficulty.",
  },
  {
    columnName: "fsrs_last_reviewed_at",
    type: "datetime",
    nullable: true,
    readOnly: true,
    filterable: false,
    sortable: false,
    description: "Persisted last reviewed timestamp.",
  },
  {
    columnName: "fsrs_scheduled_days",
    type: "integer",
    nullable: true,
    readOnly: true,
    filterable: false,
    sortable: false,
    description: "Persisted scheduled interval in days.",
  },
]);

const SQL_RESOURCE_DESCRIPTORS: Readonly<Record<SqlResourceName, SqlResourceDescriptor>> = Object.freeze({
  workspace: {
    resourceName: "workspace",
    description: "Selected workspace identity and scheduler settings.",
    writable: false,
    columns: [
      {
        columnName: "workspace_id",
        type: "uuid",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Selected workspace identifier.",
      },
      {
        columnName: "name",
        type: "string",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Selected workspace display name.",
      },
      {
        columnName: "created_at",
        type: "datetime",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Workspace creation timestamp.",
      },
      {
        columnName: "algorithm",
        type: "string",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Scheduler algorithm identifier.",
      },
      {
        columnName: "desired_retention",
        type: "number",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Workspace desired retention target.",
      },
      {
        columnName: "learning_steps_minutes",
        type: "integer[]",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Configured learning steps.",
      },
      {
        columnName: "relearning_steps_minutes",
        type: "integer[]",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Configured relearning steps.",
      },
      {
        columnName: "maximum_interval_days",
        type: "integer",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Maximum review interval in days.",
      },
      {
        columnName: "enable_fuzz",
        type: "boolean",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Whether interval fuzz is enabled.",
      },
    ],
  },
  cards: {
    resourceName: "cards",
    description: "Cards in the selected workspace.",
    writable: true,
    columns: cardColumnDescriptors,
  },
  decks: {
    resourceName: "decks",
    description: "Decks in the selected workspace.",
    writable: true,
    columns: [
      {
        columnName: "deck_id",
        type: "uuid",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Deck identifier.",
      },
      {
        columnName: "name",
        type: "string",
        nullable: false,
        readOnly: false,
        filterable: true,
        sortable: true,
        description: "Deck name.",
      },
      {
        columnName: "tags",
        type: "string[]",
        nullable: false,
        readOnly: false,
        filterable: true,
        sortable: false,
        description: "Deck filter tags.",
      },
      {
        columnName: "effort_levels",
        type: "string[]",
        nullable: false,
        readOnly: false,
        filterable: true,
        sortable: false,
        description: "Deck filter effort levels.",
      },
      {
        columnName: "created_at",
        type: "datetime",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Deck creation timestamp.",
      },
      {
        columnName: "updated_at",
        type: "datetime",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Deck last update timestamp.",
      },
      {
        columnName: "deleted_at",
        type: "datetime",
        nullable: true,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Deck deletion timestamp.",
      },
    ],
  },
  review_events: {
    resourceName: "review_events",
    description: "Immutable review event rows.",
    writable: false,
    columns: [
      {
        columnName: "review_event_id",
        type: "uuid",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Review event identifier.",
      },
      {
        columnName: "card_id",
        type: "uuid",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Reviewed card identifier.",
      },
      {
        columnName: "device_id",
        type: "uuid",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: false,
        description: "Device that submitted the review.",
      },
      {
        columnName: "client_event_id",
        type: "string",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: false,
        description: "Client event identifier.",
      },
      {
        columnName: "rating",
        type: "integer",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Submitted review rating.",
      },
      {
        columnName: "reviewed_at_client",
        type: "datetime",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Client review timestamp.",
      },
      {
        columnName: "reviewed_at_server",
        type: "datetime",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Server review timestamp.",
      },
    ],
  },
});

const SQL_RESOURCE_NAMES = Object.freeze(Object.keys(SQL_RESOURCE_DESCRIPTORS) as SqlResourceName[]);

type SqlExecutionColumnDescriptor = SqlColumnDescriptor;

function upperCaseKeyword(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeSqlWhitespace(value: string): string {
  return value.trim().replace(/;\s*$/, "").replace(/\s+/g, " ");
}

function assert(condition: boolean, message: string): void {
  if (condition === false) {
    throw new Error(message);
  }
}

function isSqlResourceName(value: string): value is SqlResourceName {
  return SQL_RESOURCE_NAMES.includes(value as SqlResourceName);
}

function getDescriptor(resourceName: SqlResourceName): SqlResourceDescriptor {
  return SQL_RESOURCE_DESCRIPTORS[resourceName];
}

function findColumnDescriptor(
  resourceName: SqlResourceName,
  columnName: string,
): SqlColumnDescriptor {
  const descriptor = getDescriptor(resourceName);
  const columnDescriptor = descriptor.columns.find((column) => column.columnName === columnName);
  if (columnDescriptor === undefined) {
    throw new Error(`Unknown column for ${resourceName}: ${columnName}`);
  }

  return columnDescriptor;
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

  const isNotNullPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+IS\s+NOT\s+NULL$/i);
  if (isNotNullPredicate !== null) {
    const columnName = (isNotNullPredicate[1] ?? "").toLowerCase();
    ensureSourceColumnExists(source, columnName);
    return {
      type: "is_not_null",
      columnName,
    };
  }

  const isNullPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+IS\s+NULL$/i);
  if (isNullPredicate !== null) {
    const columnName = (isNullPredicate[1] ?? "").toLowerCase();
    ensureSourceColumnExists(source, columnName);
    return {
      type: "is_null",
      columnName,
    };
  }

  const overlapPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+OVERLAP\s*(\(.+\))$/i);
  if (overlapPredicate !== null) {
    const columnName = (overlapPredicate[1] ?? "").toLowerCase();
    ensureSourceColumnExists(source, columnName);
    return {
      type: "overlap",
      columnName,
      values: parseStringArrayLiteralList(overlapPredicate[2] ?? ""),
    };
  }

  const inPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+IN\s*(\(.+\))$/i);
  if (inPredicate !== null) {
    const columnName = (inPredicate[1] ?? "").toLowerCase();
    ensureSourceColumnExists(source, columnName);
    return {
      type: "in",
      columnName,
      values: splitTopLevel((inPredicate[2] ?? "").slice(1, -1), ",").map(parseSqlLiteral),
    };
  }

  const comparisonPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s*(=|<=|>=|<|>)\s*(.+)$/i);
  if (comparisonPredicate !== null) {
    const columnName = (comparisonPredicate[1] ?? "").toLowerCase();
    ensureSourceColumnExists(source, columnName);
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
  return splitTopLevel(value, ",").map((item) => {
    const trimmedItem = item.trim();
    const match = trimmedItem.match(/^([a-z_][a-z0-9_]*)(?:\s+(ASC|DESC))?$/i);
    if (match === null) {
      throw new Error(`Unsupported ORDER BY item: ${trimmedItem}`);
    }

    return {
      expressionName: (match[1] ?? "").toLowerCase(),
      direction: ((match[2] ?? "ASC").toLowerCase()) as SqlOrderDirection,
    };
  });
}

function extractSimpleNumberClause(statementTail: string, keyword: string): number | null {
  const match = statementTail.match(new RegExp(`\\b${keyword}\\s+(\\d+)\\b`, "i"));
  if (match === null) {
    return null;
  }

  return Number.parseInt(match[1] ?? "0", 10);
}

function parseFromSource(resourceName: string, unnestColumnName: string | undefined, unnestAlias: string | undefined): SqlFromSource {
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
    ensureSourceColumnExists(source, columnName);
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
    ensureSourceColumnExists(source, columnName);
    return {
      type: "column",
      columnName,
      alias,
    };
  }

  throw new Error(`Unsupported SELECT item: ${trimmedValue}`);
}

function parseSelectStatement(normalizedSql: string): SqlSelectStatement {
  const selectMatch = normalizedSql.match(
    /^SELECT\s+([\s\S]+?)\s+FROM\s+([a-z_][a-z0-9_]*)(?:\s+UNNEST\s+([a-z_][a-z0-9_]*)\s+AS\s+([a-z_][a-z0-9_]*))?([\s\S]*)$/i,
  );
  if (selectMatch === null) {
    throw new Error("Unsupported SELECT statement");
  }

  const source = parseFromSource(selectMatch[2] ?? "", selectMatch[3], selectMatch[4]);
  const statementTail = selectMatch[5] ?? "";
  const whereMatch = statementTail.match(/\bWHERE\b([\s\S]+?)(?=\bGROUP BY\b|\bORDER BY\b|\bLIMIT\b|\bOFFSET\b|$)/i);
  const groupByMatch = statementTail.match(/\bGROUP BY\b([\s\S]+?)(?=\bORDER BY\b|\bLIMIT\b|\bOFFSET\b|$)/i);
  const orderByMatch = statementTail.match(/\bORDER BY\b([\s\S]+?)(?=\bLIMIT\b|\bOFFSET\b|$)/i);
  const limit = extractSimpleNumberClause(statementTail, "LIMIT");
  const offset = extractSimpleNumberClause(statementTail, "OFFSET");
  const selectItems = splitTopLevel(selectMatch[1] ?? "", ",").map((item) => parseSelectItem(source, item));
  const groupBy = groupByMatch === null
    ? []
    : splitTopLevel(groupByMatch[1] ?? "", ",").map((item) => {
      const normalizedItem = item.trim().toLowerCase();
      ensureSourceColumnExists(source, normalizedItem);
      return normalizedItem;
    });

  const wildcardSelect = selectItems.length === 1 && selectItems[0]?.type === "wildcard";
  const hasAggregateSelectItem = selectItems.some((item) => item.type === "aggregate");
  if (wildcardSelect) {
    if (groupBy.length > 0) {
      throw new Error("GROUP BY is not supported with SELECT *");
    }
  } else if (hasAggregateSelectItem === false) {
    throw new Error("Projected SELECT statements must include aggregate functions");
  }

  for (const item of selectItems) {
    if (item.type === "column" && groupBy.includes(item.columnName) === false) {
      throw new Error(`Grouped SELECT must list ${item.columnName} in GROUP BY`);
    }
  }

  if (source.unnestAlias !== null && groupBy.includes(source.unnestAlias) === false) {
    const referencesAlias = selectItems.some((item) => item.type === "column" && item.columnName === source.unnestAlias);
    if (referencesAlias) {
      throw new Error(`Grouped SELECT must list ${source.unnestAlias} in GROUP BY`);
    }
  }

  return {
    type: "select",
    source,
    selectItems,
    predicateClauses: whereMatch === null ? [] : parsePredicateClauses(source, whereMatch[1] ?? ""),
    groupBy,
    orderBy: orderByMatch === null ? [] : parseOrderBy(orderByMatch[1] ?? ""),
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

function parseDescribeStatement(normalizedSql: string): SqlDescribeStatement | null {
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
    const columnDescriptor = findColumnDescriptor(resourceName, normalizedColumnName);
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

      const columnDescriptor = findColumnDescriptor(resourceName, columnName);
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
    const match = assignment.match(/^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/i);
    if (match === null) {
      throw new Error(`Unsupported assignment: ${assignment}`);
    }

    const columnName = (match[1] ?? "").toLowerCase();
    const columnDescriptor = findColumnDescriptor(resourceName, columnName);
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
  const match = normalizedSql.match(/^UPDATE\s+([a-z_][a-z0-9_]*)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i);
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

  return {
    type: "update",
    resourceName,
    assignments: parseAssignments(resourceName, match[2] ?? ""),
    predicateClauses: parsePredicateClauses(source, match[3] ?? ""),
    normalizedSql,
  };
}

function parseDeleteStatement(normalizedSql: string): SqlDeleteStatement {
  const match = normalizedSql.match(/^DELETE\s+FROM\s+([a-z_][a-z0-9_]*)\s+WHERE\s+([\s\S]+)$/i);
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

  return {
    type: "delete",
    resourceName,
    predicateClauses: parsePredicateClauses(source, match[2] ?? ""),
    normalizedSql,
  };
}

export function getSqlResourceDescriptors(): ReadonlyArray<SqlResourceDescriptor> {
  return SQL_RESOURCE_NAMES.map((resourceName) => getDescriptor(resourceName));
}

export function getSqlResourceDescriptor(resourceName: SqlResourceName): SqlResourceDescriptor {
  return getDescriptor(resourceName);
}

export function getSqlColumnDescriptor(resourceName: SqlResourceName, columnName: string): SqlColumnDescriptor {
  return findColumnDescriptor(resourceName, columnName);
}

function defaultAggregateAlias(functionName: SqlAggregateFunctionName, columnName: string | null): string {
  if (functionName === "count") {
    return "count";
  }

  return `${functionName}_${columnName ?? "value"}`;
}

function getSourceColumnDescriptors(source: SqlFromSource): Readonly<Record<string, SqlExecutionColumnDescriptor>> {
  const baseDescriptors = Object.fromEntries(
    getDescriptor(source.resourceName).columns.map((column) => [column.columnName, column] as const),
  ) as Record<string, SqlExecutionColumnDescriptor>;

  if (source.unnestAlias === null) {
    return baseDescriptors;
  }

  return {
    ...baseDescriptors,
    [source.unnestAlias]: {
      columnName: source.unnestAlias,
      type: "string",
      nullable: false,
      readOnly: true,
      filterable: true,
      sortable: true,
      description: `Expanded ${source.unnestColumnName} element.`,
    },
  };
}

function ensureSourceColumnExists(source: SqlFromSource, columnName: string): void {
  const descriptor = getSourceColumnDescriptors(source)[columnName];
  if (descriptor === undefined) {
    throw new Error(`Unknown column for ${source.resourceName}: ${columnName}`);
  }
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

export function likePatternToRegExp(value: string): RegExp {
  const escaped = escapeRegExp(value).replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
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

function validatePredicate(source: SqlFromSource, predicate: SqlPredicate): void {
  if (predicate.type === "match") {
    return;
  }

  const columnDescriptor = getSourceColumnDescriptors(source)[predicate.columnName];
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
    return predicate.values.some((value) => valuesEqual(columnValue, value));
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

  return [...rows].sort((left, right) => {
    for (const item of orderBy) {
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
  const availableColumns = getSourceColumnDescriptors(source);
  for (const item of orderBy) {
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
  const availableColumns = getSourceColumnDescriptors(statement.source);

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

function buildAggregateOutputRow(groupRow: SqlRow, groupedRows: ReadonlyArray<SqlRow>, selectItems: ReadonlyArray<SqlSelectItem>): SqlRow {
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

function isWildcardSelect(statement: SqlSelectStatement): boolean {
  return statement.selectItems.length === 1 && statement.selectItems[0]?.type === "wildcard";
}

/**
 * iOS mirror:
 * `apps/ios/Flashcards/Flashcards/AI/LocalAIToolExecutor.swift::executeSqlSelect`
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
    : executeAggregateSelect(statement, filteredRows);
  const paginatedRows = paginateRows(orderedRows, limit, offset);

  return {
    rows: paginatedRows.rows,
    rowCount: paginatedRows.rows.length,
    limit,
    offset,
    hasMore: paginatedRows.hasMore,
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
