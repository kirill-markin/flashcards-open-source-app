import type { FunctionTool } from "openai/resources/responses/responses";

type JsonSchema = Readonly<Record<string, unknown>>;

function nullableSchema(schema: JsonSchema): Readonly<{
  anyOf: readonly [JsonSchema, Readonly<{ type: "null" }>];
}> {
  return {
    anyOf: [schema, { type: "null" }],
  };
}

function strictObjectSchema(properties: Readonly<Record<string, JsonSchema>>): Readonly<{
  type: "object";
  properties: Readonly<Record<string, JsonSchema>>;
  required: readonly string[];
  additionalProperties: false;
}> {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const EMPTY_OBJECT_SCHEMA = strictObjectSchema({});

const LIMIT_SCHEMA = {
  type: "integer",
  minimum: 1,
  maximum: 100,
} as const;

const EFFORT_LEVEL_SCHEMA = {
  type: "string",
  enum: ["fast", "medium", "long"],
} as const;

const REVIEW_RATING_SCHEMA = {
  type: "string",
  enum: ["again", "hard", "good", "easy"],
} as const;

const COMBINE_WITH_SCHEMA = {
  type: "string",
  enum: ["and", "or"],
} as const;

const TAGS_OPERATOR_SCHEMA = {
  type: "string",
  enum: ["containsAny", "containsAll"],
} as const;

const CARD_INPUT_SCHEMA = strictObjectSchema({
  frontText: { type: "string" },
  backText: { type: "string" },
  tags: {
    type: "array",
    items: { type: "string" },
  },
  effortLevel: EFFORT_LEVEL_SCHEMA,
});

const CARD_UPDATE_SCHEMA = strictObjectSchema({
  cardId: { type: "string" },
  frontText: nullableSchema({ type: "string" }),
  backText: nullableSchema({ type: "string" }),
  tags: nullableSchema({
    type: "array",
    items: { type: "string" },
  }),
  effortLevel: nullableSchema(EFFORT_LEVEL_SCHEMA),
});

const BULK_CARD_ARRAY_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 100,
} as const;

export const OPENAI_LOCAL_FLASHCARDS_TOOLS: ReadonlyArray<FunctionTool> = [
  {
    type: "function",
    name: "get_workspace_context",
    description: "Get workspace, cloud, scheduler, and top-level study counts from the local device database.",
    strict: true,
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  {
    type: "function",
    name: "list_cards",
    description: "List cards from the local device database.",
    strict: true,
    parameters: strictObjectSchema({
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
  },
  {
    type: "function",
    name: "get_card",
    description: "Get one card from the local device database by cardId.",
    strict: true,
    parameters: strictObjectSchema({
      cardId: { type: "string" },
    }),
  },
  {
    type: "function",
    name: "search_cards",
    description: "Search local cards by front text, back text, or tags.",
    strict: true,
    parameters: strictObjectSchema({
      query: { type: "string" },
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
  },
  {
    type: "function",
    name: "list_due_cards",
    description: "List cards currently due for review from the local device database.",
    strict: true,
    parameters: strictObjectSchema({
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
  },
  {
    type: "function",
    name: "list_decks",
    description: "List decks from the local device database.",
    strict: true,
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  {
    type: "function",
    name: "get_deck",
    description: "Get one deck from the local device database by deckId.",
    strict: true,
    parameters: strictObjectSchema({
      deckId: { type: "string" },
    }),
  },
  {
    type: "function",
    name: "list_review_history",
    description: "List recent local review events, optionally filtered by cardId.",
    strict: true,
    parameters: strictObjectSchema({
      limit: nullableSchema(LIMIT_SCHEMA),
      cardId: nullableSchema({ type: "string" }),
    }),
  },
  {
    type: "function",
    name: "get_scheduler_settings",
    description: "Get current workspace scheduler settings from the local device database.",
    strict: true,
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  {
    type: "function",
    name: "get_cloud_settings",
    description: "Get current cloud-link and device settings from the local device database.",
    strict: true,
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  {
    type: "function",
    name: "list_outbox",
    description: "List pending local outbox operations that have not synced yet.",
    strict: true,
    parameters: strictObjectSchema({
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
  },
  {
    type: "function",
    name: "create_card",
    description: "Create one new card locally after explicit user confirmation. Use create_cards for multiple cards.",
    strict: true,
    parameters: CARD_INPUT_SCHEMA,
  },
  {
    type: "function",
    name: "create_cards",
    description: "Create multiple new cards locally after explicit user confirmation. Use only when the user clearly requested multiple cards or you already identified multiple targets.",
    strict: true,
    parameters: strictObjectSchema({
      cards: {
        ...BULK_CARD_ARRAY_SCHEMA,
        items: CARD_INPUT_SCHEMA,
      },
    }),
  },
  {
    type: "function",
    name: "update_card",
    description: "Update one card locally after explicit user confirmation. Use update_cards for multiple cards.",
    strict: true,
    parameters: CARD_UPDATE_SCHEMA,
  },
  {
    type: "function",
    name: "update_cards",
    description: "Update multiple cards locally after explicit user confirmation. Use only when the user clearly requested multiple card changes or you already identified multiple targets.",
    strict: true,
    parameters: strictObjectSchema({
      updates: {
        ...BULK_CARD_ARRAY_SCHEMA,
        items: CARD_UPDATE_SCHEMA,
      },
    }),
  },
  {
    type: "function",
    name: "delete_card",
    description: "Delete one card locally after explicit user confirmation. Use delete_cards for multiple cards.",
    strict: true,
    parameters: strictObjectSchema({
      cardId: { type: "string" },
    }),
  },
  {
    type: "function",
    name: "delete_cards",
    description: "Delete multiple cards locally after explicit user confirmation. Use only when the user clearly requested multiple deletions or you already identified multiple targets.",
    strict: true,
    parameters: strictObjectSchema({
      cardIds: {
        ...BULK_CARD_ARRAY_SCHEMA,
        items: { type: "string" },
      },
    }),
  },
  {
    type: "function",
    name: "create_deck",
    description: "Create a new deck locally after explicit user confirmation using effort-level and tag filters.",
    strict: true,
    parameters: strictObjectSchema({
      name: { type: "string" },
      effortLevels: {
        type: "array",
        items: EFFORT_LEVEL_SCHEMA,
      },
      combineWith: COMBINE_WITH_SCHEMA,
      tagsOperator: TAGS_OPERATOR_SCHEMA,
      tags: {
        type: "array",
        items: { type: "string" },
      },
    }),
  },
  {
    type: "function",
    name: "update_deck",
    description: "Update a deck locally after explicit user confirmation using effort-level and tag filters.",
    strict: true,
    parameters: strictObjectSchema({
      deckId: { type: "string" },
      name: nullableSchema({ type: "string" }),
      effortLevels: nullableSchema({
        type: "array",
        items: EFFORT_LEVEL_SCHEMA,
      }),
      combineWith: nullableSchema(COMBINE_WITH_SCHEMA),
      tagsOperator: nullableSchema(TAGS_OPERATOR_SCHEMA),
      tags: nullableSchema({
        type: "array",
        items: { type: "string" },
      }),
    }),
  },
  {
    type: "function",
    name: "delete_deck",
    description: "Delete a deck locally after explicit user confirmation.",
    strict: true,
    parameters: strictObjectSchema({
      deckId: { type: "string" },
    }),
  },
  {
    type: "function",
    name: "submit_review",
    description: "Submit a local review rating for a card after explicit user confirmation.",
    strict: true,
    parameters: strictObjectSchema({
      cardId: { type: "string" },
      rating: REVIEW_RATING_SCHEMA,
    }),
  },
  {
    type: "function",
    name: "update_scheduler_settings",
    description: "Update workspace scheduler settings locally after explicit user confirmation.",
    strict: true,
    parameters: strictObjectSchema({
      desiredRetention: {
        type: "number",
        exclusiveMinimum: 0,
        exclusiveMaximum: 1,
      },
      learningStepsMinutes: {
        type: "array",
        items: {
          type: "integer",
          minimum: 1,
        },
      },
      relearningStepsMinutes: {
        type: "array",
        items: {
          type: "integer",
          minimum: 1,
        },
      },
      maximumIntervalDays: {
        type: "integer",
        minimum: 1,
      },
      enableFuzz: { type: "boolean" },
    }),
  },
] as const;
