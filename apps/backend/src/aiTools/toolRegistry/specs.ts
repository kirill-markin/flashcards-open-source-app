import { z } from "zod";
import {
  makeAgentReviewCardFilter,
  nextReviewCardSchema,
  revealAnswerSchema,
  submitReviewSchema,
  NEXT_REVIEW_DESCRIPTION,
  REVEAL_ANSWER_DESCRIPTION,
  REVIEW_FLOW_INSTRUCTIONS,
  SUBMIT_REVIEW_DESCRIPTION,
} from "../../agent/reviewContract";
import type { AgentReviewContext } from "../../agent/reviews";
import type { AgentSqlContext, AgentSqlPayload } from "../agentSql/shared";
import {
  GET_GUIDE_RESULT_INSTRUCTIONS,
  GUIDE_BODIES,
  GUIDE_TOPICS,
  type GuideTopic,
  SQL_EXECUTE_TOOL_DESCRIPTION,
  SQL_EXECUTE_TOOL_NAME,
  SQL_QUERY_TOOL_DESCRIPTION,
  SQL_QUERY_TOOL_NAME,
} from "../toolContract/sqlToolContract";
import type {
  AgentToolContext,
  AgentToolResult,
  AgentToolSpec,
  AgentToolSurface,
} from "./types";

export const LIST_WORKSPACES_TOOL_NAME = "list_workspaces";
export const GET_GUIDE_TOOL_NAME = "get_guide";
export const NEXT_REVIEW_CARD_TOOL_NAME = "next_review_card";
export const REVEAL_ANSWER_TOOL_NAME = "reveal_answer";
export const SUBMIT_REVIEW_TOOL_NAME = "submit_review";

const workspaceIdStringSchema = z.string().trim().check(z.guid()).toLowerCase();

const optionalWorkspaceIdArgument = workspaceIdStringSchema
  .optional()
  .describe(
    "Optional workspace UUID from the list_workspaces tool; omit to use your currently selected default workspace.",
  );

const LIST_WORKSPACES_TOOL_DESCRIPTION =
  "Lists the workspaces you can access, each with its workspaceId, name, active card count, last activity timestamp, and an isSelected flag marking your current default workspace. Use the returned workspaceId values for any workspace-scoped tool workspaceId argument; pick the isSelected one to stay on the default.";

const LIST_WORKSPACES_RESULT_INSTRUCTIONS =
  "These are the workspaces you can access. Each workspace has a workspaceId, name, cardCount (active cards), lastActivityAt (most recent card edit or review, or null), and isSelected (your current default). To target a specific one, pass its workspaceId to any workspace-scoped tool; the isSelected workspace is used by default when you omit workspaceId. Prefer the most active workspace (highest cardCount or most recent lastActivityAt) when the user has not told you which to use.";

/**
 * `get_guide` is the on-demand home for instructions a client only needs at one
 * moment, so none of this text has to sit in the always-loaded tool metadata.
 * The bodies live next to the contracts they are composed from, in
 * `apps/backend/src/aiTools/toolContract/sqlToolContract.ts`.
 */
const GET_GUIDE_TOOL_DESCRIPTION =
  "Returns one reference guide for working with this server, as plain text. Topics: sql_dialect (the full SELECT and WHERE grammar, text-column rules, UNNEST and OVERLAP, RETURNING, row and batch limits, pagination, and worked examples), card_authoring (the front/back contract, tag and duplicate rules, matching the user's existing card style, and Markdown/LaTeX formatting), bulk_authoring (sizing a batch against the database time budget, splitting a large authoring job into atomic batches, recovering an interrupted or unconfirmed run, and verifying it), and review_flow (the one-question-at-a-time review and rating loop). Reads no workspace data and changes nothing. Call it before your first authoring write, and again after a SQL syntax error, instead of guessing at the dialect.";
const GET_GUIDE_TOPIC_ARGUMENT_DESCRIPTION =
  "Which guide to return: sql_dialect for the SELECT and WHERE grammar, limits, and examples; card_authoring for the front/back contract, tags, duplicate checks, and card formatting; bulk_authoring for splitting and verifying a large write job; review_flow for the review and rating loop.";

/**
 * Pins the registry's strictness policy where a spec is declared. A plain `z.object` strips an
 * unknown argument instead of rejecting it, which would let a misspelled `workspaceId` run a
 * statement against the selected workspace, so a spec that declares one fails at module load rather
 * than at the first misdirected write. Zod carries the rule as the object's catchall: `never` for a
 * strict object, absent for a stripping one, `unknown` for a loose one.
 */
function requireStrictObjectInputSchema(toolName: string, inputSchema: z.ZodType): void {
  const catchall = inputSchema instanceof z.ZodObject ? inputSchema._zod.def.catchall : undefined;
  if (catchall === undefined || catchall._zod.def.type !== "never") {
    throw new Error(
      `Tool ${toolName} must declare its input schema as a strict object so an unknown argument is rejected instead of silently dropped.`,
    );
  }
}

/**
 * Binds a spec's typed handler to the erased `execute` the registry array carries, and parses the
 * raw arguments with the spec's own schema on the way in. Both surfaces also parse before they
 * reach a spec, MCP inside the SDK's input validation and the chat to echo back the trimmed
 * statement its result envelope carries, so this parse is the shared floor under them rather than
 * the only one.
 */
function defineAgentTool<Schema extends z.ZodType, Data>(
  definition: Readonly<{
    name: string;
    surfaces: ReadonlyArray<AgentToolSurface>;
    description: string;
    inputSchema: Schema;
    execute: (context: AgentToolContext, input: z.output<Schema>) => Promise<AgentToolResult<Data>>;
  }>,
): AgentToolSpec<Data> {
  requireStrictObjectInputSchema(definition.name, definition.inputSchema);

  return {
    name: definition.name,
    surfaces: definition.surfaces,
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: async (context, rawInput) =>
      definition.execute(context, definition.inputSchema.parse(rawInput)),
  };
}

function buildAgentSqlContext(context: AgentToolContext, workspaceId: string): AgentSqlContext {
  return {
    userId: context.userId,
    workspaceId,
    selectedWorkspaceId: context.selectedWorkspaceId,
    connectionId: context.connectionId,
    surface: context.sqlSurface,
    caller: context.caller,
  };
}

function buildReviewActor(context: AgentToolContext, workspaceId: string): AgentReviewContext {
  return { userId: context.userId, workspaceId, connectionId: context.connectionId };
}

/**
 * Both SQL input schemas are exported because the chat parses with them too: its result envelope
 * echoes the trimmed statement, and whether a write invalidates the open workspace depends on the
 * workspaceId it targeted.
 */
export const SQL_QUERY_TOOL_INPUT_SCHEMA = z.strictObject({
  sql: z
    .string()
    .trim()
    .min(1)
    .describe(
      "One or more read statements in the published Nibomo SQL dialect (SHOW TABLES, DESCRIBE, SHOW COLUMNS, SELECT).",
    ),
  workspaceId: optionalWorkspaceIdArgument,
});

export const SQL_QUERY_TOOL_SPEC = defineAgentTool({
  name: SQL_QUERY_TOOL_NAME,
  surfaces: ["mcp", "chat"],
  description: SQL_QUERY_TOOL_DESCRIPTION,
  inputSchema: SQL_QUERY_TOOL_INPUT_SCHEMA,
  execute: async (context, input): Promise<AgentToolResult<AgentSqlPayload>> => {
    const workspaceId = await context.resolveWorkspaceId(input.workspaceId);
    const result = await context.actions.runSqlQuery(
      buildAgentSqlContext(context, workspaceId),
      input.sql,
    );
    return { data: result.data, instructions: result.instructions };
  },
});

export const SQL_EXECUTE_TOOL_INPUT_SCHEMA = z.strictObject({
  sql: z
    .string()
    .trim()
    .min(1)
    .describe(
      "One or more write statements in the published Nibomo SQL dialect (INSERT, UPDATE, DELETE).",
    ),
  workspaceId: optionalWorkspaceIdArgument,
});

export const SQL_EXECUTE_TOOL_SPEC = defineAgentTool({
  name: SQL_EXECUTE_TOOL_NAME,
  surfaces: ["mcp", "chat"],
  description: SQL_EXECUTE_TOOL_DESCRIPTION,
  inputSchema: SQL_EXECUTE_TOOL_INPUT_SCHEMA,
  execute: async (context, input): Promise<AgentToolResult<AgentSqlPayload>> => {
    const workspaceId = await context.resolveWorkspaceId(input.workspaceId);
    const result = await context.actions.runSqlExecute(
      buildAgentSqlContext(context, workspaceId),
      input.sql,
    );
    return { data: result.data, instructions: result.instructions };
  },
});

/**
 * `isSelected` marks the surface's selected default workspace, which on the chat is the workspace
 * its session is bound to.
 */
export const LIST_WORKSPACES_TOOL_SPEC = defineAgentTool({
  name: LIST_WORKSPACES_TOOL_NAME,
  surfaces: ["mcp", "chat"],
  description: LIST_WORKSPACES_TOOL_DESCRIPTION,
  inputSchema: z.strictObject({}),
  execute: async (context): Promise<AgentToolResult> => {
    const workspaces = await context.actions.listUserWorkspacesWithStatsForSelectedWorkspace(
      context.userId,
      context.selectedWorkspaceId,
    );
    return { data: { workspaces }, instructions: LIST_WORKSPACES_RESULT_INSTRUCTIONS };
  },
});

/**
 * The guide payload, typed so the surface that renders its fields keeps them through the registry.
 */
export type AgentGuidePayload = Readonly<{
  topic: GuideTopic;
  guide: string;
}>;

/**
 * Served on both surfaces from one definition, so a topic added here reaches the in-app chat and
 * MCP together. It reaches no action: a guide is static text composed at module load.
 */
export const GET_GUIDE_TOOL_SPEC = defineAgentTool({
  name: GET_GUIDE_TOOL_NAME,
  surfaces: ["mcp", "chat"],
  description: GET_GUIDE_TOOL_DESCRIPTION,
  inputSchema: z.strictObject({
    topic: z.enum(GUIDE_TOPICS).describe(GET_GUIDE_TOPIC_ARGUMENT_DESCRIPTION),
  }),
  execute: async (_context, input): Promise<AgentToolResult<AgentGuidePayload>> => ({
    data: { topic: input.topic, guide: GUIDE_BODIES[input.topic] },
    instructions: GET_GUIDE_RESULT_INSTRUCTIONS,
  }),
});

/**
 * What a surface reads out of a review payload: which workspace the call resolved. The chat needs it
 * to decide whether a submitted review landed in the workspace the user has open; nothing else
 * inside these payloads is read through the registry.
 */
export type AgentReviewPayload = Readonly<{ workspaceId: string }>;

export const NEXT_REVIEW_CARD_TOOL_SPEC = defineAgentTool({
  name: NEXT_REVIEW_CARD_TOOL_NAME,
  surfaces: ["mcp", "chat"],
  description: NEXT_REVIEW_DESCRIPTION,
  inputSchema: nextReviewCardSchema,
  execute: async (context, input): Promise<AgentToolResult<AgentReviewPayload>> => {
    const workspaceId = await context.resolveWorkspaceId(input.workspaceId);
    const result = await context.actions.nextReviewCard(
      buildReviewActor(context, workspaceId),
      makeAgentReviewCardFilter(input),
    );
    return { data: result, instructions: REVIEW_FLOW_INSTRUCTIONS };
  },
});

export const REVEAL_ANSWER_TOOL_SPEC = defineAgentTool({
  name: REVEAL_ANSWER_TOOL_NAME,
  surfaces: ["mcp", "chat"],
  description: REVEAL_ANSWER_DESCRIPTION,
  inputSchema: revealAnswerSchema,
  execute: async (context, input): Promise<AgentToolResult<AgentReviewPayload>> => {
    const workspaceId = await context.resolveWorkspaceId(input.workspaceId);
    const result = await context.actions.revealAnswer(
      buildReviewActor(context, workspaceId),
      input.cardId,
    );
    return { data: result, instructions: REVIEW_FLOW_INSTRUCTIONS };
  },
});

export const SUBMIT_REVIEW_TOOL_SPEC = defineAgentTool({
  name: SUBMIT_REVIEW_TOOL_NAME,
  surfaces: ["mcp", "chat"],
  description: SUBMIT_REVIEW_DESCRIPTION,
  inputSchema: submitReviewSchema,
  execute: async (context, input): Promise<AgentToolResult<AgentReviewPayload>> => {
    const workspaceId = await context.resolveWorkspaceId(input.workspaceId);
    const result = await context.actions.submitAgentReview(
      buildReviewActor(context, workspaceId),
      input,
    );
    return { data: result, instructions: REVIEW_FLOW_INSTRUCTIONS };
  },
});

/**
 * Every agent tool this backend exposes, on every surface.
 *
 * A spec carries what both surfaces need to expose and run a tool. What differs per surface stays
 * in the adapters: MCP titles, annotations and `_meta` hints in `apps/backend/src/mcp/server.ts`,
 * the OpenAI function-tool JSON and the tool-output budget in
 * `apps/backend/src/chat/openai/tools/tools.ts`.
 */
export const AGENT_TOOL_SPECS: ReadonlyArray<AgentToolSpec> = Object.freeze([
  SQL_QUERY_TOOL_SPEC,
  SQL_EXECUTE_TOOL_SPEC,
  LIST_WORKSPACES_TOOL_SPEC,
  GET_GUIDE_TOOL_SPEC,
  NEXT_REVIEW_CARD_TOOL_SPEC,
  REVEAL_ANSWER_TOOL_SPEC,
  SUBMIT_REVIEW_TOOL_SPEC,
]);

export function listAgentToolSpecsForSurface(
  surface: AgentToolSurface,
): ReadonlyArray<AgentToolSpec> {
  return AGENT_TOOL_SPECS.filter((spec) => spec.surfaces.includes(surface));
}

export function findAgentToolSpecForSurface(
  surface: AgentToolSurface,
  toolName: string,
): AgentToolSpec | null {
  return AGENT_TOOL_SPECS.find(
    (spec) => spec.name === toolName && spec.surfaces.includes(surface),
  ) ?? null;
}
