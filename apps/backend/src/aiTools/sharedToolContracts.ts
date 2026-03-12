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
import {
  normalizeCardFilter,
  type CardFilter,
  type EffortLevel,
} from "../cards";

export type JsonSchema = Readonly<Record<string, unknown>>;

type JsonObjectSchema = Readonly<{
  type: "object";
  properties: Readonly<Record<string, JsonSchema>>;
  required: readonly string[];
  additionalProperties: false;
}>;

export type SharedAiToolName =
  | "get_workspace_context"
  | "list_tags"
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

export type AgentToolCursorInput = Readonly<{
  cursor: string | null;
  limit: number;
}>;

export type AgentToolCardCursorInput = Readonly<{
  cursor: string | null;
  limit: number;
  filter: CardFilter | null;
}>;

export type AgentToolGetCardsInput = Readonly<{
  cardIds: ReadonlyArray<string>;
}>;

export type AgentToolSearchCardsInput = Readonly<{
  query: string;
  cursor: string | null;
  limit: number;
  filter: CardFilter | null;
}>;

export type AgentToolGetDecksInput = Readonly<{
  deckIds: ReadonlyArray<string>;
}>;

export type AgentToolSearchDecksInput = Readonly<{
  query: string;
  cursor: string | null;
  limit: number;
}>;

export type AgentToolListReviewHistoryInput = Readonly<{
  cursor: string | null;
  limit: number;
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
  return strictObjectSchemaWithRequired(properties, Object.keys(properties));
}

export function strictObjectSchemaWithRequired(
  properties: Readonly<Record<string, JsonSchema>>,
  required: ReadonlyArray<string>,
): JsonObjectSchema {
  return {
    type: "object",
    properties,
    required,
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

const CURSOR_SCHEMA = nullableSchema({ type: "string" });

const UUID_SCHEMA = {
  type: "string",
  format: "uuid",
} as const;

const EFFORT_LEVEL_SCHEMA = {
  type: "string",
  enum: ["fast", "medium", "long"],
} as const;

const CARD_FILTER_SCHEMA = {
  anyOf: [
    strictObjectSchemaWithRequired({
      tags: {
        type: "array",
        items: { type: "string" },
      },
      effort: {
        type: "array",
        items: EFFORT_LEVEL_SCHEMA,
      },
    }, []),
    { type: "null" },
  ],
} as const;

const CARD_INPUT_SCHEMA = strictObjectSchemaWithRequired({
  frontText: { type: "string" },
  backText: { type: "string" },
  tags: {
    type: "array",
    items: { type: "string" },
  },
  effortLevel: EFFORT_LEVEL_SCHEMA,
}, [
  "frontText",
  "backText",
  "effortLevel",
]);

const CARD_UPDATE_SCHEMA = strictObjectSchemaWithRequired({
  cardId: UUID_SCHEMA,
  frontText: nullableSchema({ type: "string" }),
  backText: nullableSchema({ type: "string" }),
  tags: nullableSchema({
    type: "array",
    items: { type: "string" },
  }),
  effortLevel: nullableSchema(EFFORT_LEVEL_SCHEMA),
}, [
  "cardId",
]);

const DECK_INPUT_SCHEMA = strictObjectSchemaWithRequired({
  name: { type: "string" },
  effortLevels: {
    type: "array",
    items: EFFORT_LEVEL_SCHEMA,
  },
  tags: {
    type: "array",
    items: { type: "string" },
  },
}, [
  "name",
]);

const DECK_UPDATE_SCHEMA = strictObjectSchemaWithRequired({
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
}, [
  "deckId",
]);

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

const limitValidator = z.number().int().min(1).max(100);
const nullableStringValidator = z.string().nullable();
const nullableStringArrayValidator = z.array(z.string()).nullable();
const nullableEffortLevelValidator = z.enum(["fast", "medium", "long"]).nullable();
const uuidValidator = z.string().uuid();
const nullableUuidValidator = uuidValidator.nullable();
const cardFilterValidator = z.object({
  tags: z.array(z.string()).optional().default([]),
  effort: z.array(z.enum(["fast", "medium", "long"])).optional().default([]),
}).strict().transform((filter) => normalizeCardFilter(filter));
const optionalCardFilterValidator = cardFilterValidator.nullable().optional().transform((filter) => (
  filter === undefined ? null : filter
));

const createCardValidator = z.object({
  frontText: z.string(),
  backText: z.string(),
  tags: z.array(z.string()).optional().default([]),
  effortLevel: z.enum(["fast", "medium", "long"]),
}).strict();

const updateCardValidator = z.object({
  cardId: uuidValidator,
  frontText: nullableStringValidator.optional(),
  backText: nullableStringValidator.optional(),
  tags: nullableStringArrayValidator.optional(),
  effortLevel: nullableEffortLevelValidator.optional(),
}).strict().transform((input) => ({
  ...input,
  frontText: input.frontText ?? null,
  backText: input.backText ?? null,
  tags: input.tags ?? null,
  effortLevel: input.effortLevel ?? null,
}));

const createDeckValidator = z.object({
  name: z.string(),
  effortLevels: z.array(z.enum(["fast", "medium", "long"])).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
}).strict();

const updateDeckValidator = z.object({
  deckId: uuidValidator,
  name: nullableStringValidator.optional(),
  effortLevels: z.array(z.enum(["fast", "medium", "long"])).nullable().optional(),
  tags: nullableStringArrayValidator.optional(),
}).strict().transform((input) => ({
  ...input,
  name: input.name ?? null,
  effortLevels: input.effortLevels ?? null,
  tags: input.tags ?? null,
}));

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
    name: "list_tags",
    localDescription: "List all local workspace tags with per-tag card counts and the total active card count. Tag counts can overlap because one card may have multiple tags.",
    externalDescription: "List all selected-workspace tags with per-tag card counts and the total active card count. Tag counts can overlap because one card may have multiple tags.",
    jsonContract: "Use {}.",
    promptExample: "{}",
    parameters: EMPTY_OBJECT_SCHEMA,
    validator: z.object({}).strict(),
  },
  {
    name: "list_cards",
    localDescription: "List cards from the local device database. If a filter is present, tags match any selected tag, effort matches any selected effort value, and the two dimensions combine with AND.",
    externalDescription: "List cards from the selected workspace. If a filter is present, tags match any selected tag, effort matches any selected effort value, and the two dimensions combine with AND.",
    jsonContract: "Use {\"cursor\": string|null, \"limit\": number, \"filter\": {\"tags\": string[], \"effort\": (\"fast\"|\"medium\"|\"long\")[]} | null}. Start with cursor null, pass back nextCursor unchanged, and stop when nextCursor is null. Omit filter or set it to null for no filter. Inside filter, tags match any selected tag, effort matches any selected effort value, and the two dimensions combine with AND.",
    promptExample: "{\"cursor\": null, \"limit\": 20, \"filter\": null}",
    parameters: strictObjectSchemaWithRequired({
      cursor: CURSOR_SCHEMA,
      limit: LIMIT_SCHEMA,
      filter: CARD_FILTER_SCHEMA,
    }, [
      "cursor",
      "limit",
    ]),
    validator: z.object({
      cursor: nullableStringValidator,
      limit: limitValidator,
      filter: optionalCardFilterValidator,
    }).strict().transform((input) => ({
      ...input,
      filter: input.filter ?? null,
    })),
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
    localDescription: "Search local cards by front text, back text, tags, or effort level. Split query by whitespace into up to 5 lowercase tokens (merge extra tokens into the fifth token), require every token to match, and allow each token to match any supported card field. If a filter is present, tags match any selected tag, effort matches any selected effort value, and the two dimensions combine with AND.",
    externalDescription: "Search cards by front text, back text, tags, or effort level. The query is split by whitespace into up to 5 lowercase tokens (extra tokens are merged into the fifth token), every token must match, and each token may match any supported card field. If a filter is present, tags match any selected tag, effort matches any selected effort value, and the two dimensions combine with AND.",
    jsonContract: "Use {\"query\": string, \"cursor\": string|null, \"limit\": number, \"filter\": {\"tags\": string[], \"effort\": (\"fast\"|\"medium\"|\"long\")[]} | null}. Start with cursor null, pass back nextCursor unchanged, and stop when nextCursor is null. Omit filter or set it to null for no filter. Inside filter, tags match any selected tag, effort matches any selected effort value, and the two dimensions combine with AND.",
    promptExample: "{\"query\": \"grammar\", \"cursor\": null, \"limit\": 20, \"filter\": null}",
    parameters: strictObjectSchemaWithRequired({
      query: { type: "string" },
      cursor: CURSOR_SCHEMA,
      limit: LIMIT_SCHEMA,
      filter: CARD_FILTER_SCHEMA,
    }, [
      "query",
      "cursor",
      "limit",
    ]),
    validator: z.object({
      query: z.string(),
      cursor: nullableStringValidator,
      limit: limitValidator,
      filter: optionalCardFilterValidator,
    }).strict().transform((input) => ({
      ...input,
      filter: input.filter ?? null,
    })),
  },
  {
    name: "list_due_cards",
    localDescription: "List cards currently due for review from the local device database.",
    externalDescription: "List cards currently due for review in the selected workspace.",
    jsonContract: "Use {\"cursor\": string|null, \"limit\": number}. Start with cursor null, pass back nextCursor unchanged, and stop when nextCursor is null.",
    promptExample: "{\"cursor\": null, \"limit\": 20}",
    parameters: strictObjectSchema({
      cursor: CURSOR_SCHEMA,
      limit: LIMIT_SCHEMA,
    }),
    validator: z.object({
      cursor: nullableStringValidator,
      limit: limitValidator,
    }).strict(),
  },
  {
    name: "list_decks",
    localDescription: "List decks from the local device database.",
    externalDescription: "List decks from the selected workspace.",
    jsonContract: "Use {\"cursor\": string|null, \"limit\": number}. Start with cursor null, pass back nextCursor unchanged, and stop when nextCursor is null.",
    promptExample: "{\"cursor\": null, \"limit\": 20}",
    parameters: strictObjectSchema({
      cursor: CURSOR_SCHEMA,
      limit: LIMIT_SCHEMA,
    }),
    validator: z.object({
      cursor: nullableStringValidator,
      limit: limitValidator,
    }).strict(),
  },
  {
    name: "search_decks",
    localDescription: "Search local decks by name, tags, or effort levels. Split query by whitespace into up to 5 lowercase tokens (merge extra tokens into the fifth token) and match if any token matches.",
    externalDescription: "Search decks by name, tags, or effort levels. The query is split by whitespace into up to 5 lowercase tokens (extra tokens are merged into the fifth token) and matches when any token matches.",
    jsonContract: "Use {\"query\": string, \"cursor\": string|null, \"limit\": number}. Start with cursor null, pass back nextCursor unchanged, and stop when nextCursor is null.",
    promptExample: "{\"query\": \"grammar\", \"cursor\": null, \"limit\": 20}",
    parameters: strictObjectSchema({
      query: { type: "string" },
      cursor: CURSOR_SCHEMA,
      limit: LIMIT_SCHEMA,
    }),
    validator: z.object({
      query: z.string(),
      cursor: nullableStringValidator,
      limit: limitValidator,
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
    jsonContract: "Use {\"cursor\": string|null, \"limit\": number, \"cardId\": string|null}. Start with cursor null, pass back nextCursor unchanged, and stop when nextCursor is null.",
    promptExample: "{\"cursor\": null, \"limit\": 20, \"cardId\": null}",
    parameters: strictObjectSchema({
      cursor: CURSOR_SCHEMA,
      limit: LIMIT_SCHEMA,
      cardId: nullableSchema({ type: "string" }),
    }),
    validator: z.object({
      cursor: nullableStringValidator,
      limit: limitValidator,
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
    jsonContract: "Use {\"cards\": CardInput[]} where every card object includes frontText, backText, and effortLevel. tags is optional and defaults to an empty array when omitted. Enforce the card side contract: frontText must be a question-only recall prompt (no answer), and backText must contain the answer; include a concrete example on backText when helpful, preferably in a fenced markdown code block.",
    promptExample: "{\"cards\": [{\"frontText\": \"Question\", \"backText\": \"Answer\", \"effortLevel\": \"medium\"}]}",
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
    jsonContract: "Use {\"updates\": UpdateCardInput[]} where every update object includes cardId and any fields to change. Omit a field or use null to keep it unchanged. Enforce the card side contract for any provided text: frontText must be a question-only recall prompt (no answer), and backText must contain the answer; include a concrete example on backText when helpful, preferably in a fenced markdown code block.",
    promptExample: "{\"updates\": [{\"cardId\": \"123e4567-e89b-42d3-a456-426614174000\", \"backText\": \"Updated back\"}]}",
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
    jsonContract: "Use {\"decks\": DeckInput[]} where every deck object includes name. effortLevels and tags are optional and default to empty arrays when omitted.",
    promptExample: "{\"decks\": [{\"name\": \"Grammar\"}]}",
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
    jsonContract: "Use {\"updates\": UpdateDeckInput[]} where every update object includes deckId and any fields to change. Omit a field or use null to keep it unchanged.",
    promptExample: "{\"updates\": [{\"deckId\": \"123e4567-e89b-42d3-a456-426614174001\", \"name\": \"Updated name\"}]}",
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
    strict: false,
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
  "list_tags",
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
