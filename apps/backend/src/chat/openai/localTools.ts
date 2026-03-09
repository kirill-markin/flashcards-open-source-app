import type { FunctionTool } from "openai/resources/responses/responses";

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

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

const CARD_INPUT_SCHEMA = {
  type: "object",
  properties: {
    frontText: { type: "string" },
    backText: { type: "string" },
    tags: {
      type: "array",
      items: { type: "string" },
    },
    effortLevel: EFFORT_LEVEL_SCHEMA,
  },
  required: ["frontText", "backText", "tags", "effortLevel"],
  additionalProperties: false,
} as const;

const CARD_UPDATE_SCHEMA = {
  type: "object",
  properties: {
    cardId: { type: "string" },
    frontText: { type: "string" },
    backText: { type: "string" },
    tags: {
      type: "array",
      items: { type: "string" },
    },
    effortLevel: EFFORT_LEVEL_SCHEMA,
  },
  required: ["cardId"],
  additionalProperties: false,
} as const;

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
    parameters: {
      type: "object",
      properties: {
        limit: LIMIT_SCHEMA,
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_card",
    description: "Get one card from the local device database by cardId.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        cardId: { type: "string" },
      },
      required: ["cardId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "search_cards",
    description: "Search local cards by front text, back text, or tags.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: LIMIT_SCHEMA,
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "list_due_cards",
    description: "List cards currently due for review from the local device database.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        limit: LIMIT_SCHEMA,
      },
      additionalProperties: false,
    },
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
    parameters: {
      type: "object",
      properties: {
        deckId: { type: "string" },
      },
      required: ["deckId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "list_review_history",
    description: "List recent local review events, optionally filtered by cardId.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        limit: LIMIT_SCHEMA,
        cardId: { type: "string" },
      },
      additionalProperties: false,
    },
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
    parameters: {
      type: "object",
      properties: {
        limit: LIMIT_SCHEMA,
      },
      additionalProperties: false,
    },
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
    parameters: {
      type: "object",
      properties: {
        cards: {
          ...BULK_CARD_ARRAY_SCHEMA,
          items: CARD_INPUT_SCHEMA,
        },
      },
      required: ["cards"],
      additionalProperties: false,
    },
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
    parameters: {
      type: "object",
      properties: {
        updates: {
          ...BULK_CARD_ARRAY_SCHEMA,
          items: CARD_UPDATE_SCHEMA,
        },
      },
      required: ["updates"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "delete_card",
    description: "Delete one card locally after explicit user confirmation. Use delete_cards for multiple cards.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        cardId: { type: "string" },
      },
      required: ["cardId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "delete_cards",
    description: "Delete multiple cards locally after explicit user confirmation. Use only when the user clearly requested multiple deletions or you already identified multiple targets.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        cardIds: {
          ...BULK_CARD_ARRAY_SCHEMA,
          items: { type: "string" },
        },
      },
      required: ["cardIds"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_deck",
    description: "Create a new deck locally after explicit user confirmation using effort-level and tag filters.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
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
      },
      required: ["name", "effortLevels", "combineWith", "tagsOperator", "tags"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_deck",
    description: "Update a deck locally after explicit user confirmation using effort-level and tag filters.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        deckId: { type: "string" },
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
      },
      required: ["deckId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "delete_deck",
    description: "Delete a deck locally after explicit user confirmation.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        deckId: { type: "string" },
      },
      required: ["deckId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "submit_review",
    description: "Submit a local review rating for a card after explicit user confirmation.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        rating: REVIEW_RATING_SCHEMA,
      },
      required: ["cardId", "rating"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_scheduler_settings",
    description: "Update workspace scheduler settings locally after explicit user confirmation.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
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
      },
      required: [
        "desiredRetention",
        "learningStepsMinutes",
        "relearningStepsMinutes",
        "maximumIntervalDays",
        "enableFuzz",
      ],
      additionalProperties: false,
    },
  },
] as const;
