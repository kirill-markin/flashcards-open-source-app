/**
 * Backend adapter that exposes the AI-chat tool contract to the OpenAI
 * Responses API.
 */
import type { FunctionTool } from "openai/resources/responses/responses";
import {
  OPENAI_SQL_TOOL,
  SQL_TOOL_ARGUMENT_VALIDATOR,
} from "../../aiTools/sqlToolContract";
export const OPENAI_AI_CHAT_TOOL_ARGUMENT_VALIDATORS = {
  sql: SQL_TOOL_ARGUMENT_VALIDATOR,
} as const;

export const OPENAI_AI_CHAT_TOOLS: ReadonlyArray<FunctionTool> = [
  OPENAI_SQL_TOOL,
] as const;
