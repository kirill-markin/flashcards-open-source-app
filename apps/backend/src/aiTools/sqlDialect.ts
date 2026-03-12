export type SqlResourceName =
  | "workspace_context"
  | "scheduler_settings"
  | "tags_summary"
  | "cards"
  | "due_cards"
  | "decks"
  | "review_history";

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

export type SqlPredicate =
  | Readonly<{
    type: "comparison";
    columnName: string;
    operator: "=";
    value: SqlLiteral;
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
    type: "match";
    query: string;
  }>;

export type SqlSelectOrderBy = Readonly<{
  columnName: string;
  direction: SqlOrderDirection;
}>;

export type SqlSelectStatement = Readonly<{
  type: "select";
  resourceName: SqlResourceName;
  predicates: ReadonlyArray<SqlPredicate>;
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
  predicates: ReadonlyArray<SqlPredicate>;
  normalizedSql: string;
}>;

export type SqlDeleteStatement = Readonly<{
  type: "delete";
  resourceName: "cards" | "decks";
  predicates: ReadonlyArray<SqlPredicate>;
  normalizedSql: string;
}>;

export type ParsedSqlStatement =
  | SqlShowTablesStatement
  | SqlDescribeStatement
  | SqlSelectStatement
  | SqlInsertStatement
  | SqlUpdateStatement
  | SqlDeleteStatement;

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
  workspace_context: {
    resourceName: "workspace_context",
    description: "Selected workspace summary plus deck summary and scheduler settings.",
    writable: false,
    columns: [
      {
        columnName: "workspace_id",
        type: "uuid",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Selected workspace identifier.",
      },
      {
        columnName: "workspace_name",
        type: "string",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Selected workspace display name.",
      },
      {
        columnName: "total_cards",
        type: "integer",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Total active cards in the selected workspace.",
      },
      {
        columnName: "due_cards",
        type: "integer",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Active due cards count.",
      },
      {
        columnName: "new_cards",
        type: "integer",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Active unseen cards count.",
      },
      {
        columnName: "reviewed_cards",
        type: "integer",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Active reviewed cards count.",
      },
    ],
  },
  scheduler_settings: {
    resourceName: "scheduler_settings",
    description: "Workspace-level scheduler settings.",
    writable: false,
    columns: [
      {
        columnName: "algorithm",
        type: "string",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Scheduler algorithm identifier.",
      },
      {
        columnName: "desired_retention",
        type: "number",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
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
        filterable: false,
        sortable: false,
        description: "Maximum review interval in days.",
      },
      {
        columnName: "enable_fuzz",
        type: "boolean",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Whether interval fuzz is enabled.",
      },
    ],
  },
  tags_summary: {
    resourceName: "tags_summary",
    description: "Workspace tag summary with counts.",
    writable: false,
    columns: [
      {
        columnName: "tag",
        type: "string",
        nullable: false,
        readOnly: true,
        filterable: true,
        sortable: true,
        description: "Workspace tag.",
      },
      {
        columnName: "cards_count",
        type: "integer",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: true,
        description: "Active cards count for the tag.",
      },
      {
        columnName: "total_cards",
        type: "integer",
        nullable: false,
        readOnly: true,
        filterable: false,
        sortable: false,
        description: "Total active cards in the workspace.",
      },
    ],
  },
  cards: {
    resourceName: "cards",
    description: "Cards in the selected workspace.",
    writable: true,
    columns: cardColumnDescriptors,
  },
  due_cards: {
    resourceName: "due_cards",
    description: "Cards currently due for review.",
    writable: false,
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
  review_history: {
    resourceName: "review_history",
    description: "Immutable review history rows.",
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

function parsePredicate(resourceName: SqlResourceName, value: string): SqlPredicate {
  const trimmedValue = value.trim();
  const matchPredicate = trimmedValue.match(/^MATCH\s*\(\s*('(?:''|[^'])*')\s*\)$/i);
  if (matchPredicate !== null) {
    return {
      type: "match",
      query: parseStringLiteral(matchPredicate[1] ?? ""),
    };
  }

  const isNullPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+IS\s+NULL$/i);
  if (isNullPredicate !== null) {
    const columnName = isNullPredicate[1]?.toLowerCase() ?? "";
    findColumnDescriptor(resourceName, columnName);
    return {
      type: "is_null",
      columnName,
    };
  }

  const overlapPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+OVERLAP\s*(\(.+\))$/i);
  if (overlapPredicate !== null) {
    const columnName = overlapPredicate[1]?.toLowerCase() ?? "";
    findColumnDescriptor(resourceName, columnName);
    return {
      type: "overlap",
      columnName,
      values: parseStringArrayLiteralList(overlapPredicate[2] ?? ""),
    };
  }

  const inPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s+IN\s*(\(.+\))$/i);
  if (inPredicate !== null) {
    const columnName = inPredicate[1]?.toLowerCase() ?? "";
    findColumnDescriptor(resourceName, columnName);
    return {
      type: "in",
      columnName,
      values: splitTopLevel((inPredicate[2] ?? "").slice(1, -1), ",").map(parseSqlLiteral),
    };
  }

  const comparisonPredicate = trimmedValue.match(/^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/i);
  if (comparisonPredicate !== null) {
    const columnName = comparisonPredicate[1]?.toLowerCase() ?? "";
    findColumnDescriptor(resourceName, columnName);
    return {
      type: "comparison",
      columnName,
      operator: "=",
      value: parseSqlLiteral(comparisonPredicate[2] ?? ""),
    };
  }

  throw new Error(`Unsupported predicate: ${trimmedValue}`);
}

function parseOrderBy(resourceName: SqlResourceName, value: string): ReadonlyArray<SqlSelectOrderBy> {
  return splitTopLevel(value, ",").map((item) => {
    const trimmedItem = item.trim();
    const match = trimmedItem.match(/^([a-z_][a-z0-9_]*)(?:\s+(ASC|DESC))?$/i);
    if (match === null) {
      throw new Error(`Unsupported ORDER BY item: ${trimmedItem}`);
    }

    const columnName = match[1]?.toLowerCase() ?? "";
    const direction = (match[2]?.toLowerCase() ?? "asc") as SqlOrderDirection;
    const columnDescriptor = findColumnDescriptor(resourceName, columnName);
    if (columnDescriptor.sortable === false) {
      throw new Error(`Column is not sortable: ${columnName}`);
    }

    return {
      columnName,
      direction,
    };
  });
}

function extractClause(statementTail: string, keyword: string): string | null {
  const match = statementTail.match(new RegExp(`\\b${keyword}\\b([\\s\\S]+)$`, "i"));
  if (match === null) {
    return null;
  }

  return match[1]?.trim() ?? null;
}

function extractSimpleNumberClause(statementTail: string, keyword: string): number | null {
  const match = statementTail.match(new RegExp(`\\b${keyword}\\s+(\\d+)\\b`, "i"));
  if (match === null) {
    return null;
  }

  return Number.parseInt(match[1] ?? "0", 10);
}

function parseSelectStatement(normalizedSql: string): SqlSelectStatement {
  const selectMatch = normalizedSql.match(/^SELECT\s+\*\s+FROM\s+([a-z_][a-z0-9_]*)([\s\S]*)$/i);
  if (selectMatch === null) {
    throw new Error("Unsupported SELECT statement");
  }

  const resourceName = (selectMatch[1] ?? "").toLowerCase();
  if (isSqlResourceName(resourceName) === false) {
    throw new Error(`Unknown resource: ${resourceName}`);
  }

  const statementTail = selectMatch[2] ?? "";
  const whereMatch = statementTail.match(/\bWHERE\b([\s\S]+?)(?=\bORDER BY\b|\bLIMIT\b|\bOFFSET\b|$)/i);
  const orderByMatch = statementTail.match(/\bORDER BY\b([\s\S]+?)(?=\bLIMIT\b|\bOFFSET\b|$)/i);
  const limit = extractSimpleNumberClause(statementTail, "LIMIT");
  const offset = extractSimpleNumberClause(statementTail, "OFFSET");

  return {
    type: "select",
    resourceName,
    predicates: whereMatch === null
      ? []
      : splitTopLevel(whereMatch[1] ?? "", "AND").map((predicate) => parsePredicate(resourceName, predicate)),
    orderBy: orderByMatch === null ? [] : parseOrderBy(resourceName, orderByMatch[1] ?? ""),
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

    const columnName = match[1]?.toLowerCase() ?? "";
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

  return {
    type: "update",
    resourceName,
    assignments: parseAssignments(resourceName, match[2] ?? ""),
    predicates: splitTopLevel(match[3] ?? "", "AND").map((predicate) => parsePredicate(resourceName, predicate)),
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

  return {
    type: "delete",
    resourceName,
    predicates: splitTopLevel(match[2] ?? "", "AND").map((predicate) => parsePredicate(resourceName, predicate)),
    normalizedSql,
  };
}

export function getSqlResourceDescriptors(): ReadonlyArray<SqlResourceDescriptor> {
  return SQL_RESOURCE_NAMES.map((resourceName) => getDescriptor(resourceName));
}

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
