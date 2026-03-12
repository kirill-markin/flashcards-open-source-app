/**
 * Backend adapter that exposes the local-tool contract to the OpenAI Responses
 * API. Shared tool names, validators, JSON schemas, and prompt examples live
 * in `apps/backend/src/aiTools/sharedToolContracts.ts`.
 *
 * This file only adds local-runtime-only tools that do not exist on the
 * external public agent API and wires the canonical shared contract into the
 * OpenAI-specific `FunctionTool` shape.
 *
 * Mirrored runtime executors live in:
 * - `apps/web/src/chat/localToolExecutor.ts`
 * - `apps/ios/Flashcards/Flashcards/AI/LocalAIToolExecutor.swift`
 */
import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import {
  EMPTY_OBJECT_SCHEMA,
  LIMIT_SCHEMA,
  SHARED_AI_TOOL_ARGUMENT_VALIDATORS,
  SHARED_OPENAI_LOCAL_FLASHCARDS_TOOLS,
  nullableSchema,
  strictObjectSchema,
  strictToolDescription,
} from "../../aiTools/sharedToolContracts";

const LOCAL_ONLY_TOOL_ARGUMENT_VALIDATORS = {
  get_cloud_settings: z.object({}).strict(),
  list_outbox: z.object({
    cursor: z.string().nullable(),
    limit: z.number().int().min(1).max(100),
  }).strict(),
} as const;

const LOCAL_ONLY_OPENAI_TOOLS: ReadonlyArray<FunctionTool> = [
  {
    type: "function",
    name: "get_cloud_settings",
    description: strictToolDescription(
      "Get current cloud-link and device settings from the local device database.",
      "Use {}.",
    ),
    strict: false,
    parameters: EMPTY_OBJECT_SCHEMA,
  },
  {
    type: "function",
    name: "list_outbox",
    description: strictToolDescription(
      "List pending local outbox operations that have not synced yet.",
      "Use {\"cursor\": string|null, \"limit\": number}. Start with cursor null, pass back nextCursor unchanged, and stop when nextCursor is null.",
    ),
    strict: false,
    parameters: strictObjectSchema({
      cursor: nullableSchema({ type: "string" }),
      limit: LIMIT_SCHEMA,
    }),
  },
];

export const OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS = {
  ...SHARED_AI_TOOL_ARGUMENT_VALIDATORS,
  ...LOCAL_ONLY_TOOL_ARGUMENT_VALIDATORS,
} as const;

export const OPENAI_LOCAL_FLASHCARDS_TOOLS: ReadonlyArray<FunctionTool> = [
  ...SHARED_OPENAI_LOCAL_FLASHCARDS_TOOLS,
  ...LOCAL_ONLY_OPENAI_TOOLS,
] as const;
