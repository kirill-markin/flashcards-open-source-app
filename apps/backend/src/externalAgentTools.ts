import {
  SHARED_EXTERNAL_AGENT_TOOL_DEFINITIONS,
  type SharedAiToolName,
} from "./aiTools/sharedToolContracts";

export type ExternalAgentToolName = SharedAiToolName;

export type ExternalAgentToolDefinition = Readonly<{
  name: ExternalAgentToolName;
  description: string;
}>;

export const EXTERNAL_AGENT_TOOL_MAX_RESULT_COUNT = 100;

/**
 * Canonical external AI-agent tool catalog for the public cloud contract.
 * Source descriptions are defined once in
 * `apps/backend/src/aiTools/sharedToolContracts.ts`; this module exists only
 * to expose the external-agent subset and max-result policy in one obvious
 * place for route and envelope code.
 */
export const EXTERNAL_AGENT_TOOL_DEFINITIONS: ReadonlyArray<ExternalAgentToolDefinition> =
  SHARED_EXTERNAL_AGENT_TOOL_DEFINITIONS;
