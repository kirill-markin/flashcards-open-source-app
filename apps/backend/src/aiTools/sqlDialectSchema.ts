import type {
  SqlColumnDescriptor,
  SqlFromSource,
  SqlResourceDescriptor,
  SqlResourceName,
} from "./sqlDialectTypes";

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
    columnName: "created_at",
    type: "datetime",
    nullable: false,
    readOnly: true,
    filterable: true,
    sortable: true,
    description: "Card creation timestamp.",
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

function getDescriptor(resourceName: SqlResourceName): SqlResourceDescriptor {
  return SQL_RESOURCE_DESCRIPTORS[resourceName];
}

export function isSqlResourceName(value: string): value is SqlResourceName {
  return SQL_RESOURCE_NAMES.includes(value as SqlResourceName);
}

export function getSqlResourceDescriptors(): ReadonlyArray<SqlResourceDescriptor> {
  return SQL_RESOURCE_NAMES.map((resourceName) => getDescriptor(resourceName));
}

export function getSqlResourceDescriptor(resourceName: SqlResourceName): SqlResourceDescriptor {
  return getDescriptor(resourceName);
}

export function getSqlColumnDescriptor(
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

export function getSqlSourceColumnDescriptors(
  source: SqlFromSource,
): Readonly<Record<string, SqlColumnDescriptor>> {
  const baseDescriptors = Object.fromEntries(
    getDescriptor(source.resourceName).columns.map((column) => [column.columnName, column] as const),
  ) as Record<string, SqlColumnDescriptor>;

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

export function ensureSqlSourceColumnExists(source: SqlFromSource, columnName: string): void {
  const descriptor = getSqlSourceColumnDescriptors(source)[columnName];
  if (descriptor === undefined) {
    throw new Error(`Unknown column for ${source.resourceName}: ${columnName}`);
  }
}
