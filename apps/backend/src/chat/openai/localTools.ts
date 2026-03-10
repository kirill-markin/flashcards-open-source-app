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

const REVIEW_RATING_SCHEMA = {
  type: "string",
  enum: ["again", "hard", "good", "easy"],
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
  get_deck: z.object({
    deckId: z.string(),
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
  create_deck: z.object({
    name: z.string(),
    effortLevels: z.array(z.enum(["fast", "medium", "long"])),
    tags: z.array(z.string()),
  }).strict(),
  update_deck: z.object({
    deckId: z.string(),
    name: nullableStringValidator,
    effortLevels: z.array(z.enum(["fast", "medium", "long"])).nullable(),
    tags: nullableStringArrayValidator,
  }).strict(),
  delete_deck: z.object({
    deckId: z.string(),
  }).strict(),
  submit_review: z.object({
    cardId: z.string(),
    rating: z.enum(["again", "hard", "good", "easy"]),
  }).strict(),
  update_scheduler_settings: z.object({
    desiredRetention: z.number().gt(0).lt(1),
    learningStepsMinutes: z.array(z.number().int().min(1)),
    relearningStepsMinutes: z.array(z.number().int().min(1)),
    maximumIntervalDays: z.number().int().min(1),
    enableFuzz: z.boolean(),
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
    name: "get_deck",
    description: strictDescription(
      "Get one deck from the local device database by deckId.",
      "Use {\"deckId\": string}."
    ),
    strict: true,
    parameters: strictObjectSchema({
      deckId: { type: "string" },
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
    name: "create_deck",
    description: strictDescription(
      "Create a new deck locally using effort-level and tag filters.",
      "Use {\"name\": string, \"effortLevels\": (\"fast\"|\"medium\"|\"long\")[], \"tags\": string[]}."
    ),
    strict: true,
    parameters: strictObjectSchema({
      name: { type: "string" },
      effortLevels: {
        type: "array",
        items: EFFORT_LEVEL_SCHEMA,
      },
      tags: {
        type: "array",
        items: { type: "string" },
      },
    }),
  },
  {
    type: "function",
    name: "update_deck",
    description: strictDescription(
      "Update a deck locally using effort-level and tag filters.",
      "Use {\"deckId\": string, \"name\": string|null, \"effortLevels\": (\"fast\"|\"medium\"|\"long\")[]|null, \"tags\": string[]|null}. Include every property. Use null for unchanged fields."
    ),
    strict: true,
    parameters: strictObjectSchema({
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
    }),
  },
  {
    type: "function",
    name: "delete_deck",
    description: strictDescription(
      "Delete a deck locally.",
      "Use {\"deckId\": string}."
    ),
    strict: true,
    parameters: strictObjectSchema({
      deckId: { type: "string" },
    }),
  },
  {
    type: "function",
    name: "submit_review",
    description: strictDescription(
      "Submit a local review rating for a card.",
      "Use {\"cardId\": string, \"rating\": \"again\"|\"hard\"|\"good\"|\"easy\"}."
    ),
    strict: true,
    parameters: strictObjectSchema({
      cardId: { type: "string" },
      rating: REVIEW_RATING_SCHEMA,
    }),
  },
  {
    type: "function",
    name: "update_scheduler_settings",
    description: strictDescription(
      "Update workspace scheduler settings locally.",
      "Use {\"desiredRetention\": number, \"learningStepsMinutes\": integer[], \"relearningStepsMinutes\": integer[], \"maximumIntervalDays\": integer, \"enableFuzz\": boolean}. Include every property."
    ),
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
