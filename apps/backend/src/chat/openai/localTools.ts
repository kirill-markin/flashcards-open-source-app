import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

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

function strictDescription(base: string, jsonContract: string): string {
  return `${base} Return arguments as exactly one JSON object. ${jsonContract}`;
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

const DECK_INPUT_SCHEMA = strictObjectSchema({
  name: { type: "string" },
  effortLevels: {
    type: "array",
    items: EFFORT_LEVEL_SCHEMA,
  },
  tags: {
    type: "array",
    items: { type: "string" },
  },
});

const DECK_UPDATE_SCHEMA = strictObjectSchema({
  deckId: { type: "string" },
  name: nullableSchema({ type: "string" }),
  effortLevels: nullableSchema({
    type: "array",
    items: EFFORT_LEVEL_SCHEMA,
  }),
  tags: nullableSchema({
    type: "array",
    items: { type: "string" },
  }),
});

const BULK_CARD_ARRAY_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 100,
} as const;

const BULK_DECK_ARRAY_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 100,
} as const;

const nullableLimitValidator = z.number().int().min(1).max(100).nullable();
const nullableStringValidator = z.string().nullable();
const nullableStringArrayValidator = z.array(z.string()).nullable();
const nullableEffortLevelValidator = z.enum(["fast", "medium", "long"]).nullable();

const createCardValidator = z.object({
  frontText: z.string(),
  backText: z.string(),
  tags: z.array(z.string()),
  effortLevel: z.enum(["fast", "medium", "long"]),
}).strict();

const updateCardValidator = z.object({
  cardId: z.string(),
  frontText: nullableStringValidator,
  backText: nullableStringValidator,
  tags: nullableStringArrayValidator,
  effortLevel: nullableEffortLevelValidator,
}).strict();

const createDeckValidator = z.object({
  name: z.string(),
  effortLevels: z.array(z.enum(["fast", "medium", "long"])),
  tags: z.array(z.string()),
}).strict();

const updateDeckValidator = z.object({
  deckId: z.string(),
  name: nullableStringValidator,
  effortLevels: z.array(z.enum(["fast", "medium", "long"])).nullable(),
  tags: nullableStringArrayValidator,
}).strict();

export const OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS: Readonly<Record<string, z.ZodType<unknown>>> = {
  get_workspace_context: z.object({}).strict(),
  list_cards: z.object({
    limit: nullableLimitValidator,
  }).strict(),
  get_cards: z.object({
    cardIds: z.array(z.string()).min(1).max(100),
  }).strict(),
  search_cards: z.object({
    query: z.string(),
    limit: nullableLimitValidator,
  }).strict(),
  list_due_cards: z.object({
    limit: nullableLimitValidator,
  }).strict(),
  list_decks: z.object({}).strict(),
  search_decks: z.object({
    query: z.string(),
    limit: nullableLimitValidator,
  }).strict(),
  get_decks: z.object({
    deckIds: z.array(z.string()).min(1).max(100),
  }).strict(),
  list_review_history: z.object({
    limit: nullableLimitValidator,
    cardId: nullableStringValidator,
  }).strict(),
  get_scheduler_settings: z.object({}).strict(),
  get_cloud_settings: z.object({}).strict(),
  list_outbox: z.object({
    limit: nullableLimitValidator,
  }).strict(),
  create_cards: z.object({
    cards: z.array(createCardValidator).min(1).max(100),
  }).strict(),
  update_cards: z.object({
    updates: z.array(updateCardValidator).min(1).max(100),
  }).strict(),
  delete_cards: z.object({
    cardIds: z.array(z.string()).min(1).max(100),
  }).strict(),
  create_decks: z.object({
    decks: z.array(createDeckValidator).min(1).max(100),
  }).strict(),
  update_decks: z.object({
    updates: z.array(updateDeckValidator).min(1).max(100),
  }).strict(),
  delete_decks: z.object({
    deckIds: z.array(z.string()).min(1).max(100),
  }).strict(),
} as const;

export const OPENAI_LOCAL_FLASHCARDS_TOOLS: ReadonlyArray<FunctionTool> = [
  {
    type: "function",
    name: "get_workspace_context",
    description: strictDescription(
      "Get workspace, cloud, scheduler, and top-level study counts from the local device database.",
      "Use {}."
    ),
    strict: true,
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  {
    type: "function",
    name: "list_cards",
    description: strictDescription(
      "List cards from the local device database.",
      "Use {\"limit\": number|null}. Include \"limit\": null when no limit is needed."
    ),
    strict: true,
    parameters: strictObjectSchema({
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
  },
  {
    type: "function",
    name: "get_cards",
    description: strictDescription(
      "Get one or more cards from the local device database by cardId.",
      "Use {\"cardIds\": string[]}. Include one or more cardIds."
    ),
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
    name: "search_cards",
    description: strictDescription(
      "Search local cards by front text, back text, or tags.",
      "Use {\"query\": string, \"limit\": number|null}. Include both properties every time."
    ),
    strict: true,
    parameters: strictObjectSchema({
      query: { type: "string" },
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
  },
  {
    type: "function",
    name: "list_due_cards",
    description: strictDescription(
      "List cards currently due for review from the local device database.",
      "Use {\"limit\": number|null}. Include \"limit\": null when no limit is needed."
    ),
    strict: true,
    parameters: strictObjectSchema({
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
  },
  {
    type: "function",
    name: "list_decks",
    description: strictDescription(
      "List decks from the local device database.",
      "Use {}."
    ),
    strict: true,
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  {
    type: "function",
    name: "search_decks",
    description: strictDescription(
      "Search local decks by name, tags, or effort levels.",
      "Use {\"query\": string, \"limit\": number|null}. Include both properties every time."
    ),
    strict: true,
    parameters: strictObjectSchema({
      query: { type: "string" },
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
  },
  {
    type: "function",
    name: "get_decks",
    description: strictDescription(
      "Get one or more decks from the local device database by deckId.",
      "Use {\"deckIds\": string[]}. Include one or more deckIds."
    ),
    strict: true,
    parameters: strictObjectSchema({
      deckIds: {
        ...BULK_DECK_ARRAY_SCHEMA,
        items: { type: "string" },
      },
    }),
  },
  {
    type: "function",
    name: "list_review_history",
    description: strictDescription(
      "List recent local review events, optionally filtered by cardId.",
      "Use {\"limit\": number|null, \"cardId\": string|null}. Include both properties every time."
    ),
    strict: true,
    parameters: strictObjectSchema({
      limit: nullableSchema(LIMIT_SCHEMA),
      cardId: nullableSchema({ type: "string" }),
    }),
  },
  {
    type: "function",
    name: "get_scheduler_settings",
    description: strictDescription(
      "Get current workspace scheduler settings from the local device database.",
      "Use {}."
    ),
    strict: true,
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  {
    type: "function",
    name: "get_cloud_settings",
    description: strictDescription(
      "Get current cloud-link and device settings from the local device database.",
      "Use {}."
    ),
    strict: true,
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  {
    type: "function",
    name: "list_outbox",
    description: strictDescription(
      "List pending local outbox operations that have not synced yet.",
      "Use {\"limit\": number|null}. Include \"limit\": null when no limit is needed."
    ),
    strict: true,
    parameters: strictObjectSchema({
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
  },
  {
    type: "function",
    name: "create_cards",
    description: strictDescription(
      "Create one or more new cards locally.",
      "Use {\"cards\": CardInput[]} where every card object includes frontText, backText, tags, and effortLevel."
    ),
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
    name: "update_cards",
    description: strictDescription(
      "Update one or more cards locally.",
      "Use {\"updates\": UpdateCardInput[]} where every update object includes cardId, frontText, backText, tags, and effortLevel. Use null for unchanged fields."
    ),
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
    name: "delete_cards",
    description: strictDescription(
      "Delete one or more cards locally.",
      "Use {\"cardIds\": string[]}."
    ),
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
    name: "create_decks",
    description: strictDescription(
      "Create one or more new decks locally using effort-level and tag filters.",
      "Use {\"decks\": DeckInput[]} where every deck object includes name, effortLevels, and tags."
    ),
    strict: true,
    parameters: strictObjectSchema({
      decks: {
        ...BULK_DECK_ARRAY_SCHEMA,
        items: DECK_INPUT_SCHEMA,
      },
    }),
  },
  {
    type: "function",
    name: "update_decks",
    description: strictDescription(
      "Update one or more decks locally using effort-level and tag filters.",
      "Use {\"updates\": UpdateDeckInput[]} where every update object includes deckId, name, effortLevels, and tags. Use null for unchanged fields."
    ),
    strict: true,
    parameters: strictObjectSchema({
      updates: {
        ...BULK_DECK_ARRAY_SCHEMA,
        items: DECK_UPDATE_SCHEMA,
      },
    }),
  },
  {
    type: "function",
    name: "delete_decks",
    description: strictDescription(
      "Delete one or more decks locally.",
      "Use {\"deckIds\": string[]}."
    ),
    strict: true,
    parameters: strictObjectSchema({
      deckIds: {
        ...BULK_DECK_ARRAY_SCHEMA,
        items: { type: "string" },
      },
    }),
  },
] as const;
