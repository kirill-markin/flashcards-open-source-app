import type { z } from "zod";
import type { nextReviewCard, revealAnswer, submitAgentReview } from "../../agent/reviews";
import type { WorkspaceSummaryWithStats } from "../../workspaces";
import type {
  AgentSqlContext,
  AgentSqlExecutionResult,
  AgentSqlSurface,
} from "../agentSql/shared";

/**
 * Which agent surfaces expose a tool. Membership only: a spec never branches on it, it declares
 * where it belongs and each adapter registers the specs that list its own surface.
 */
export type AgentToolSurface = "mcp" | "chat";

/**
 * Runs one SQL statement batch. The URL an external surface measures its emitted agent envelope
 * against is bound by that surface when it builds the action, so no spec has to carry it.
 */
export type AgentSqlAction = (
  context: AgentSqlContext,
  sql: string,
) => Promise<AgentSqlExecutionResult>;

/**
 * The backend work a tool handler reaches. Each adapter names every action, which is what keeps the
 * existing injection points intact: the MCP server binds from `McpServerDependencies` and the chat
 * from `OpenAIToolDependencies`, and an action no tool on that surface reaches is bound to
 * `unboundAgentToolAction`. Omitting one is a type error, so a tool added to a surface later cannot
 * quietly call production code around that surface's dependencies and its tests' fakes.
 */
export type AgentToolActions = Readonly<{
  runSqlQuery: AgentSqlAction;
  runSqlExecute: AgentSqlAction;
  listUserWorkspacesWithStatsForSelectedWorkspace: (
    userId: string,
    selectedWorkspaceId: string | null,
  ) => Promise<ReadonlyArray<WorkspaceSummaryWithStats>>;
  nextReviewCard: typeof nextReviewCard;
  revealAnswer: typeof revealAnswer;
  submitAgentReview: typeof submitAgentReview;
}>;

/**
 * What a tool handler is given, in terms no surface owns. The result envelope, the output budget,
 * and the telemetry channel differ per surface and stay in the adapters.
 */
export type AgentToolContext = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  connectionId: string;
  /** Best-effort label of the foreign client behind the surface, recorded in SQL telemetry. */
  caller: string | null;
  sqlSurface: AgentSqlSurface;
  resolveWorkspaceId: (explicitWorkspaceId: string | undefined) => Promise<string>;
  actions: AgentToolActions;
}>;

/** The payload and the instructions each surface wraps in its own result envelope. */
export type AgentToolResult<Data = unknown> = Readonly<{
  data: Data;
  instructions: string;
}>;

/**
 * `Data` stays open so a surface that reads inside a payload keeps its type through the registry:
 * the chat renders the SQL payload's own fields, while a surface that only forwards the payload
 * into an envelope reads it as `unknown`.
 */
export type AgentToolSpec<Data = unknown> = Readonly<{
  name: string;
  surfaces: ReadonlyArray<AgentToolSurface>;
  description: string;
  /**
   * A strict object, enforced by `defineAgentTool` at module load: an unknown argument is rejected
   * on every surface instead of silently dropped, so a misspelled `workspaceId` cannot run a
   * statement against the selected workspace.
   */
  inputSchema: z.ZodType;
  execute: (context: AgentToolContext, rawInput: unknown) => Promise<AgentToolResult<Data>>;
}>;
