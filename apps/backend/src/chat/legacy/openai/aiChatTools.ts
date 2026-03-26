/**
 * Legacy chat backend tool adapter for old OpenAI `/chat/turn` clients.
 * The backend-first `/chat` stack exposes tools through a different server-owned runtime contract.
 * TODO: Remove this legacy module after most users have updated to app versions that use the new chat endpoints.
 */
import type { FunctionTool } from "openai/resources/responses/responses";
import {
  OPENAI_SQL_TOOL,
  SQL_TOOL_ARGUMENT_VALIDATOR,
} from "../../../aiTools/sqlToolContract";
export const OPENAI_AI_CHAT_TOOL_ARGUMENT_VALIDATORS = {
  sql: SQL_TOOL_ARGUMENT_VALIDATOR,
} as const;

export const OPENAI_AI_CHAT_TOOLS: ReadonlyArray<FunctionTool> = [
  OPENAI_SQL_TOOL,
] as const;
