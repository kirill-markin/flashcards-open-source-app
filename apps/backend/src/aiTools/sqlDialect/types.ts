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
    type: "like";
    columnName: string;
    pattern: string;
    caseInsensitive: boolean;
  }>
  | Readonly<{
    type: "in";
    columnName: string;
    values: ReadonlyArray<SqlLiteral>;
    caseInsensitive: boolean;
    isNegated: boolean;
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

export type SqlSelectOrderBy =
  | Readonly<{
    type: "column";
    expressionName: string;
    direction: SqlOrderDirection;
  }>
  | Readonly<{
    type: "random";
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
