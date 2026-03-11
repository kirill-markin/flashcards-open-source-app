/**
 * Canonical TypeScript contract source for AI tools shared conceptually across:
 * - external agent routes in `apps/backend/src/routes/agent.ts`
 * - backend external-tool catalog in `apps/backend/src/externalAgentTools.ts`
 * - backend local-tool adapter in `apps/backend/src/chat/openai/localTools.ts`
 * - backend prompt examples in `apps/backend/src/chat/promptSections.ts`
 *
 * Browser-local and iOS-local runtimes intentionally keep mirrored
 * implementations because they execute against local app state instead of the
 * backend database:
 * - `apps/web/src/chat/localToolExecutor.ts`
 * - `apps/ios/Flashcards/Flashcards/AI/LocalAIToolExecutor.swift`
 *
 * This module is the canonical TypeScript contract layer only. It does not try
 * to unify data access across runtimes or across languages.
 */
import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import type { EffortLevel } from "../cards";

export type JsonSchema = Readonly<Record<string, unknown>>;

type JsonObjectSchema = Readonly<{
  type: "object";
  properties: Readonly<Record<string, JsonSchema>>;
  required: readonly string[];
  additionalProperties: false;
}>;

export type SharedAiToolName =
  | "get_workspace_context"
  | "list_cards"
  | "get_cards"
  | "search_cards"
  | "list_due_cards"
  | "list_decks"
  | "get_decks"
  | "search_decks"
  | "list_review_history"
  | "get_scheduler_settings"
  | "create_cards"
  | "update_cards"
  | "delete_cards"
  | "create_decks"
  | "update_decks"
  | "delete_decks";

export type AgentToolLimitInput = Readonly<{
  limit: number | null;
}>;

export type AgentToolGetCardsInput = Readonly<{
  cardIds: ReadonlyArray<string>;
}>;

export type AgentToolSearchCardsInput = Readonly<{
  query: string;
  limit: number | null;
}>;

export type AgentToolGetDecksInput = Readonly<{
  deckIds: ReadonlyArray<string>;
}>;

export type AgentToolSearchDecksInput = Readonly<{
  query: string;
  limit: number | null;
}>;

export type AgentToolListReviewHistoryInput = Readonly<{
  limit: number | null;
  cardId: string | null;
}>;

export type AgentToolCreateCardBody = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: EffortLevel;
}>;

export type AgentToolUpdateCardBody = Readonly<{
  cardId: string;
  frontText: string | null;
  backText: string | null;
  tags: ReadonlyArray<string> | null;
  effortLevel: EffortLevel | null;
}>;

export type AgentToolCreateCardsInput = Readonly<{
  cards: ReadonlyArray<AgentToolCreateCardBody>;
}>;

export type AgentToolUpdateCardsInput = Readonly<{
  updates: ReadonlyArray<AgentToolUpdateCardBody>;
}>;

export type AgentToolDeleteCardsInput = Readonly<{
  cardIds: ReadonlyArray<string>;
}>;

export type AgentToolCreateDeckBody = Readonly<{
  name: string;
  effortLevels: ReadonlyArray<EffortLevel>;
  tags: ReadonlyArray<string>;
}>;

export type AgentToolUpdateDeckBody = Readonly<{
  deckId: string;
  name: string | null;
  effortLevels: ReadonlyArray<EffortLevel> | null;
  tags: ReadonlyArray<string> | null;
}>;

export type AgentToolCreateDecksInput = Readonly<{
  decks: ReadonlyArray<AgentToolCreateDeckBody>;
}>;

export type AgentToolUpdateDecksInput = Readonly<{
  updates: ReadonlyArray<AgentToolUpdateDeckBody>;
}>;

export type AgentToolDeleteDecksInput = Readonly<{
  deckIds: ReadonlyArray<string>;
}>;

export function nullableSchema(schema: JsonSchema): Readonly<{
  anyOf: readonly [JsonSchema, Readonly<{ type: "null" }>];
}> {
  return {
    anyOf: [schema, { type: "null" }],
  };
}

export function strictObjectSchema(
  properties: Readonly<Record<string, JsonSchema>>,
): JsonObjectSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export function strictToolDescription(base: string, jsonContract: string): string {
  return `${base} Return arguments as exactly one JSON object. ${jsonContract}`;
}

export const EMPTY_OBJECT_SCHEMA = strictObjectSchema({});

export const LIMIT_SCHEMA = {
  type: "integer",
  minimum: 1,
  maximum: 100,
} as const;

const UUID_SCHEMA = {
  type: "string",
  format: "uuid",
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
  cardId: UUID_SCHEMA,
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
  deckId: UUID_SCHEMA,
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
const uuidValidator = z.string().uuid();
const nullableUuidValidator = uuidValidator.nullable();

const createCardValidator = z.object({
  frontText: z.string(),
  backText: z.string(),
  tags: z.array(z.string()),
  effortLevel: z.enum(["fast", "medium", "long"]),
}).strict();

const updateCardValidator = z.object({
  cardId: uuidValidator,
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
  deckId: uuidValidator,
  name: nullableStringValidator,
  effortLevels: z.array(z.enum(["fast", "medium", "long"])).nullable(),
  tags: nullableStringArrayValidator,
}).strict();

type SharedAiToolContract = Readonly<{
  name: SharedAiToolName;
  localDescription: string;
  externalDescription: string;
  jsonContract: string;
  promptExample: string;
  parameters: JsonObjectSchema;
  validator: z.ZodType<unknown>;
}>;

const SHARED_AI_TOOL_CONTRACTS: ReadonlyArray<SharedAiToolContract> = [
  {
    name: "get_workspace_context",
    localDescription: "Get workspace, cloud, scheduler, and top-level study counts from the local device database.",
    externalDescription: "Load the selected workspace summary, deck summary, and scheduler settings.",
    jsonContract: "Use {}.",
    promptExample: "{}",
    parameters: EMPTY_OBJECT_SCHEMA,
    validator: z.object({}).strict(),
  },
  {
    name: "list_cards",
    localDescription: "List cards from the local device database.",
    externalDescription: "List cards from the selected workspace.",
    jsonContract: "Use {\"limit\": number|null}. Include \"limit\": null when no limit is needed.",
    promptExample: "{\"limit\": 20}",
    parameters: strictObjectSchema({
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
    validator: z.object({
      limit: nullableLimitValidator,
    }).strict(),
  },
  {
    name: "get_cards",
    localDescription: "Get one or more cards from the local device database by cardId.",
    externalDescription: "Load one or more cards by cardId from the selected workspace.",
    jsonContract: "Use {\"cardIds\": string[]}. Include one or more cardIds.",
    promptExample: "{\"cardIds\": [\"123e4567-e89b-42d3-a456-426614174000\"]}",
    parameters: strictObjectSchema({
      cardIds: {
        ...BULK_CARD_ARRAY_SCHEMA,
        items: UUID_SCHEMA,
      },
    }),
    validator: z.object({
      cardIds: z.array(uuidValidator).min(1).max(100),
    }).strict(),
  },
  {
    name: "search_cards",
    localDescription: "Search local cards by front text, back text, tags, or effort level. Split query by whitespace into up to 5 lowercase tokens (merge extra tokens into the fifth token), require every token to match, and allow each token to match any supported card field.",
    externalDescription: "Search cards by front text, back text, tags, or effort level. The query is split by whitespace into up to 5 lowercase tokens (extra tokens are merged into the fifth token), every token must match, and each token may match any supported card field.",
    jsonContract: "Use {\"query\": string, \"limit\": number|null}. Include both properties every time.",
    promptExample: "{\"query\": \"grammar\", \"limit\": null}",
    parameters: strictObjectSchema({
      query: { type: "string" },
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
    validator: z.object({
      query: z.string(),
      limit: nullableLimitValidator,
    }).strict(),
  },
  {
    name: "list_due_cards",
    localDescription: "List cards currently due for review from the local device database.",
    externalDescription: "List cards currently due for review in the selected workspace.",
    jsonContract: "Use {\"limit\": number|null}. Include \"limit\": null when no limit is needed.",
    promptExample: "{\"limit\": 20}",
    parameters: strictObjectSchema({
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
    validator: z.object({
      limit: nullableLimitValidator,
    }).strict(),
  },
  {
    name: "list_decks",
    localDescription: "List decks from the local device database.",
    externalDescription: "List decks from the selected workspace.",
    jsonContract: "Use {}.",
    promptExample: "{}",
    parameters: EMPTY_OBJECT_SCHEMA,
    validator: z.object({}).strict(),
  },
  {
    name: "search_decks",
    localDescription: "Search local decks by name, tags, or effort levels. Split query by whitespace into up to 5 lowercase tokens (merge extra tokens into the fifth token) and match if any token matches.",
    externalDescription: "Search decks by name, tags, or effort levels. The query is split by whitespace into up to 5 lowercase tokens (extra tokens are merged into the fifth token) and matches when any token matches.",
    jsonContract: "Use {\"query\": string, \"limit\": number|null}. Include both properties every time.",
    promptExample: "{\"query\": \"grammar\", \"limit\": null}",
    parameters: strictObjectSchema({
      query: { type: "string" },
      limit: nullableSchema(LIMIT_SCHEMA),
    }),
    validator: z.object({
      query: z.string(),
      limit: nullableLimitValidator,
    }).strict(),
  },
  {
    name: "get_decks",
    localDescription: "Get one or more decks from the local device database by deckId.",
    externalDescription: "Load one or more decks by deckId from the selected workspace.",
    jsonContract: "Use {\"deckIds\": string[]}. Include one or more deckIds.",
    promptExample: "{\"deckIds\": [\"123e4567-e89b-42d3-a456-426614174001\"]}",
    parameters: strictObjectSchema({
      deckIds: {
        ...BULK_DECK_ARRAY_SCHEMA,
        items: UUID_SCHEMA,
      },
    }),
    validator: z.object({
      deckIds: z.array(uuidValidator).min(1).max(100),
    }).strict(),
  },
  {
    name: "list_review_history",
    localDescription: "List recent local review events, optionally filtered by cardId.",
    externalDescription: "List recent review events, optionally filtered by cardId.",
    jsonContract: "Use {\"limit\": number|null, \"cardId\": string|null}. Include both properties every time.",
    promptExample: "{\"limit\": 20, \"cardId\": null}",
    parameters: strictObjectSchema({
      limit: nullableSchema(LIMIT_SCHEMA),
      cardId: nullableSchema({ type: "string" }),
    }),
    validator: z.object({
      limit: nullableLimitValidator,
      cardId: nullableUuidValidator,
    }).strict(),
  },
  {
    name: "get_scheduler_settings",
    localDescription: "Get current workspace scheduler settings from the local device database.",
    externalDescription: "Load the selected workspace scheduler settings.",
    jsonContract: "Use {}.",
    promptExample: "{}",
    parameters: EMPTY_OBJECT_SCHEMA,
    validator: z.object({}).strict(),
  },
  {
    name: "create_cards",
    localDescription: "Create one or more new cards locally.",
    externalDescription: "Create one or more cards in the selected workspace. Use the flashcard side contract: frontText is a question-only recall prompt (no answer), and backText contains the answer with an optional concrete example.",
    jsonContract: "Use {\"cards\": CardInput[]} where every card object includes frontText, backText, tags, and effortLevel. Enforce the card side contract: frontText must be a question-only recall prompt (no answer), and backText must contain the answer; include a concrete example on backText when helpful, preferably in a fenced markdown code block.",
    promptExample: "{\"cards\": [{\"frontText\": \"Question\", \"backText\": \"Answer\", \"tags\": [\"grammar\"], \"effortLevel\": \"medium\"}]}",
    parameters: strictObjectSchema({
      cards: {
        ...BULK_CARD_ARRAY_SCHEMA,
        items: CARD_INPUT_SCHEMA,
      },
    }),
    validator: z.object({
      cards: z.array(createCardValidator).min(1).max(100),
    }).strict(),
  },
  {
    name: "update_cards",
    localDescription: "Update one or more cards locally.",
    externalDescription: "Update one or more cards in the selected workspace. For provided text fields, use the flashcard side contract: frontText is a question-only recall prompt (no answer), and backText contains the answer with an optional concrete example.",
    jsonContract: "Use {\"updates\": UpdateCardInput[]} where every update object includes cardId, frontText, backText, tags, and effortLevel. Use null for unchanged fields. Enforce the card side contract for any provided text: frontText must be a question-only recall prompt (no answer), and backText must contain the answer; include a concrete example on backText when helpful, preferably in a fenced markdown code block.",
    promptExample: "{\"updates\": [{\"cardId\": \"123e4567-e89b-42d3-a456-426614174000\", \"frontText\": null, \"backText\": \"Updated back\", \"tags\": null, \"effortLevel\": null}]}",
    parameters: strictObjectSchema({
      updates: {
        ...BULK_CARD_ARRAY_SCHEMA,
        items: CARD_UPDATE_SCHEMA,
      },
    }),
    validator: z.object({
      updates: z.array(updateCardValidator).min(1).max(100),
    }).strict(),
  },
  {
    name: "delete_cards",
    localDescription: "Delete one or more cards locally.",
    externalDescription: "Delete one or more cards in the selected workspace.",
    jsonContract: "Use {\"cardIds\": string[]}.",
    promptExample: "{\"cardIds\": [\"123e4567-e89b-42d3-a456-426614174000\"]}",
    parameters: strictObjectSchema({
      cardIds: {
        ...BULK_CARD_ARRAY_SCHEMA,
        items: UUID_SCHEMA,
      },
    }),
    validator: z.object({
      cardIds: z.array(uuidValidator).min(1).max(100),
    }).strict(),
  },
  {
    name: "create_decks",
    localDescription: "Create one or more new decks locally using effort-level and tag filters.",
    externalDescription: "Create one or more decks in the selected workspace.",
    jsonContract: "Use {\"decks\": DeckInput[]} where every deck object includes name, effortLevels, and tags.",
    promptExample: "{\"decks\": [{\"name\": \"Grammar\", \"effortLevels\": [\"fast\", \"medium\"], \"tags\": [\"grammar\"]}]}",
    parameters: strictObjectSchema({
      decks: {
        ...BULK_DECK_ARRAY_SCHEMA,
        items: DECK_INPUT_SCHEMA,
      },
    }),
    validator: z.object({
      decks: z.array(createDeckValidator).min(1).max(100),
    }).strict(),
  },
  {
    name: "update_decks",
    localDescription: "Update one or more decks locally using effort-level and tag filters.",
    externalDescription: "Update one or more decks in the selected workspace.",
    jsonContract: "Use {\"updates\": UpdateDeckInput[]} where every update object includes deckId, name, effortLevels, and tags. Use null for unchanged fields.",
    promptExample: "{\"updates\": [{\"deckId\": \"123e4567-e89b-42d3-a456-426614174001\", \"name\": null, \"effortLevels\": [\"fast\", \"medium\"], \"tags\": [\"grammar\"]}]}",
    parameters: strictObjectSchema({
      updates: {
        ...BULK_DECK_ARRAY_SCHEMA,
        items: DECK_UPDATE_SCHEMA,
      },
    }),
    validator: z.object({
      updates: z.array(updateDeckValidator).min(1).max(100),
    }).strict(),
  },
  {
    name: "delete_decks",
    localDescription: "Delete one or more decks locally.",
    externalDescription: "Delete one or more decks in the selected workspace.",
    jsonContract: "Use {\"deckIds\": string[]}.",
    promptExample: "{\"deckIds\": [\"123e4567-e89b-42d3-a456-426614174001\"]}",
    parameters: strictObjectSchema({
      deckIds: {
        ...BULK_DECK_ARRAY_SCHEMA,
        items: UUID_SCHEMA,
      },
    }),
    validator: z.object({
      deckIds: z.array(uuidValidator).min(1).max(100),
    }).strict(),
  },
] as const;

export const SHARED_AI_TOOL_NAMES: ReadonlyArray<SharedAiToolName> = SHARED_AI_TOOL_CONTRACTS.map(
  (contract) => contract.name,
);

export const SHARED_AI_TOOL_ARGUMENT_VALIDATORS: Readonly<Record<SharedAiToolName, z.ZodType<unknown>>> = Object.freeze(
  Object.fromEntries(
    SHARED_AI_TOOL_CONTRACTS.map((contract) => [contract.name, contract.validator]),
  ) as Record<SharedAiToolName, z.ZodType<unknown>>,
);

export const SHARED_OPENAI_LOCAL_FLASHCARDS_TOOLS: ReadonlyArray<FunctionTool> = SHARED_AI_TOOL_CONTRACTS.map(
  (contract) => ({
    type: "function",
    name: contract.name,
    description: strictToolDescription(contract.localDescription, contract.jsonContract),
    strict: true,
    parameters: contract.parameters,
  }),
);

export const SHARED_EXTERNAL_AGENT_TOOL_DEFINITIONS: ReadonlyArray<Readonly<{
  name: SharedAiToolName;
  description: string;
}>> = SHARED_AI_TOOL_CONTRACTS.map((contract) => ({
  name: contract.name,
  description: contract.externalDescription,
}));

const SHARED_AI_TOOL_PROMPT_EXAMPLE_NAMES: ReadonlyArray<SharedAiToolName> = [
  "list_cards",
  "get_cards",
  "search_cards",
  "search_decks",
  "get_decks",
  "list_review_history",
  "update_cards",
  "update_decks",
];

const SHARED_AI_TOOL_PROMPT_EXAMPLE_BY_NAME: Readonly<Record<SharedAiToolName, string>> = Object.freeze(
  Object.fromEntries(
    SHARED_AI_TOOL_CONTRACTS.map((contract) => [contract.name, contract.promptExample]),
  ) as Record<SharedAiToolName, string>,
);

export const SHARED_AI_TOOL_PROMPT_EXAMPLE_LINES: ReadonlyArray<string> = SHARED_AI_TOOL_PROMPT_EXAMPLE_NAMES.map(
  (toolName) => `- ${toolName} => ${SHARED_AI_TOOL_PROMPT_EXAMPLE_BY_NAME[toolName]}`,
);
