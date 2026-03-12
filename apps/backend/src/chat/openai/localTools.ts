/**
 * Backend adapter that exposes the local-tool contract to the OpenAI Responses
 * API.
 *
 * Shared workspace data access now goes through the single `sql` tool. This
 * file only adds local-runtime-only utilities that do not exist on the public
 * agent API.
 *
 * Mirrored runtime executors live in:
 * - `apps/web/src/chat/localToolExecutor.ts`
 * - `apps/ios/Flashcards/Flashcards/AI/LocalAIToolExecutor.swift`
 */
import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import {
  OPENAI_SQL_TOOL,
  SQL_TOOL_ARGUMENT_VALIDATOR,
} from "../../aiTools/sqlToolContract";

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
    description: "Get current cloud-link and device settings from the local device database. Use {}.",
    strict: false,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "list_outbox",
    description: "List pending local outbox operations that have not synced yet. Use {\"cursor\": string|null, \"limit\": number}.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        cursor: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
        },
      },
      required: ["cursor", "limit"],
      additionalProperties: false,
    },
  },
];

export const OPENAI_LOCAL_TOOL_ARGUMENT_VALIDATORS = {
  sql: SQL_TOOL_ARGUMENT_VALIDATOR,
  ...LOCAL_ONLY_TOOL_ARGUMENT_VALIDATORS,
} as const;

export const OPENAI_LOCAL_FLASHCARDS_TOOLS: ReadonlyArray<FunctionTool> = [
  OPENAI_SQL_TOOL,
  ...LOCAL_ONLY_OPENAI_TOOLS,
] as const;
