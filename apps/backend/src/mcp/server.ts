import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import {
  nextReviewCard,
  resolveAgentConnectionReviewReplica,
  revealAnswer,
  submitAgentReview,
} from "../agent/reviews";
import { runSqlExecute, runSqlQuery } from "../aiTools/agentSql";
import type { AgentSqlContext, AgentSqlExecutionResult } from "../aiTools/agentSql/shared";
import { createAgentRemediationInstructions } from "../aiTools/toolContract/remediationInstructions";
import {
  SQL_EXECUTE_TOOL_NAME,
  SQL_QUERY_TOOL_NAME,
} from "../aiTools/toolContract/sqlToolContract";
import { MAX_SQL_RESULT_CHARS } from "../aiTools/toolContract/sqlToolLimits";
import {
  listAgentToolSpecsForSurface,
  GET_GUIDE_TOOL_NAME,
  LIST_WORKSPACES_TOOL_NAME,
  NEXT_REVIEW_CARD_TOOL_NAME,
  REVEAL_ANSWER_TOOL_NAME,
  SUBMIT_REVIEW_TOOL_NAME,
} from "../aiTools/toolRegistry/specs";
import type { AgentToolContext } from "../aiTools/toolRegistry/types";
import {
  resolveAccessibleAgentWorkspaceId,
  type WorkspaceRequestContext,
} from "../server/requestContext";
import { createAgentEnvelope, createAgentErrorEnvelope } from "../agent/envelope";
import { getMcpRequestId } from "./requestTelemetry";
import { createPublicHttpErrorDetails, HttpError } from "../shared/errors";
import {
  listUserWorkspacesWithStatsForSelectedWorkspace,
  type WorkspaceSummaryWithStats,
} from "../workspaces";
import {
  captureBackendException,
  captureBackendWarning,
  createBackendObservationScope,
  normalizeCaughtError,
} from "../observability/sentry";
import { hasReportedBackendException } from "../observability/reporting";
import type { AuthenticatedMcpAccessToken } from "../auth/mcpTokens";

const SERVER_NAME = "flashcards-open-source-app";
const SERVER_VERSION = "v1";

/**
 * Server instructions are always loaded, and a client that truncates them keeps
 * the head, so the routing path and the rules a call must not get wrong come
 * first and the dialect caveat and reference material follow.
 *
 * The review loop is deliberately absent: every review tool already returns
 * `REVIEW_FLOW_INSTRUCTIONS` in full with each result, and `get_guide` topic
 * `review_flow` serves the same block on demand. The card-authoring contract
 * and its example are likewise absent: `sql_execute` carries the rules a write
 * must not get wrong, and `get_guide` topic `card_authoring` carries the rest.
 */
const SERVER_INSTRUCTIONS = [
  "Call list_workspaces first to pick a workspaceId, or omit it for the selected default. Then use sql_query for reads and sql_execute for authoring writes. To review, call next_review_card, then reveal_answer, then submit_review. Call get_guide for detail.",
  "Hard rules: front_text is a question and never the answer; every new card needs at least one tag; reuse existing workspace tags; check for duplicates with sql_query before creating; describe broad deletes or updates before running them.",
  "The dialect is not full PostgreSQL. Published resources, already workspace-scoped: workspace, cards, decks, review_events. A deck is a saved tag filter, so a card has no deck_id and belongs to a deck only by matching tags. get_guide topics: sql_dialect for the grammar, limits, and examples; card_authoring for the card contract and formatting; bulk_authoring for splitting and verifying a large write job; review_flow for the review loop.",
].join(" ");

/**
 * MCP-only presentation metadata for a shared tool spec: the display title, the behavioural hints
 * an MCP client renders, and the result-size hint below. Everything a tool is - its name,
 * description, input schema and handler - lives in `apps/backend/src/aiTools/toolRegistry`.
 *
 * `maxResultSizeChars` is our own emitted-result budget rather than a client preference: a result
 * that size is one we already bounded, so a client must keep it inline in the conversation instead
 * of offloading it to a file the model then has to read back. Tools without one set it to null.
 */
type McpToolPresentation = Readonly<{
  title: string;
  annotations: ToolAnnotations;
  maxResultSizeChars: number | null;
}>;

const MCP_TOOL_PRESENTATION: Readonly<Record<string, McpToolPresentation | undefined>> = {
  // sql_query rejects mutations before execution, and SELECT-backed reads run through read-only
  // scoped database transactions. openWorldHint is false because it acts only within our own closed
  // database domain; idempotentHint is true because repeating the same read has no additional
  // effect.
  [SQL_QUERY_TOOL_NAME]: {
    title: "Nibomo SQL query (read-only)",
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    maxResultSizeChars: MAX_SQL_RESULT_CHARS,
  },
  // sql_execute mutates our own database. Spell out the (MCP-default) non-read-only + destructive
  // hints explicitly; openWorldHint is false because it acts only within our own closed database
  // domain. Same result budget as sql_query, and for the same reason: this is the size we already
  // shrink a committed write's result down to.
  [SQL_EXECUTE_TOOL_NAME]: {
    title: "Nibomo SQL execute (write)",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    maxResultSizeChars: MAX_SQL_RESULT_CHARS,
  },
  [LIST_WORKSPACES_TOOL_NAME]: {
    title: "List flashcards workspaces",
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    maxResultSizeChars: null,
  },
  // get_guide returns static contract text: no workspace is read, nothing is written, and the same
  // topic always returns the same body.
  [GET_GUIDE_TOOL_NAME]: {
    title: "Get flashcards usage guide",
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    maxResultSizeChars: null,
  },
  [NEXT_REVIEW_CARD_TOOL_NAME]: {
    title: "Next flashcard question",
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    maxResultSizeChars: null,
  },
  [REVEAL_ANSWER_TOOL_NAME]: {
    title: "Reveal flashcard answer",
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    maxResultSizeChars: null,
  },
  // submit_review's destructiveHint is true because the write overwrites due_at, reps, lapses and
  // the fsrs_* columns; only additive-only writes may claim false.
  [SUBMIT_REVIEW_TOOL_NAME]: {
    title: "Submit flashcard review",
    annotations: {
      readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true,
    },
    maxResultSizeChars: null,
  },
};

function requireMcpToolPresentation(toolName: string): McpToolPresentation {
  const presentation = MCP_TOOL_PRESENTATION[toolName];
  if (presentation === undefined) {
    throw new Error(
      `Tool ${toolName} is listed for the MCP surface but carries no MCP presentation metadata.`,
    );
  }

  return presentation;
}

export type McpServerDependencies = Readonly<{
  nextReviewCard: typeof nextReviewCard;
  revealAnswer: typeof revealAnswer;
  submitAgentReview: typeof submitAgentReview;
  resolveAccessibleAgentWorkspaceId: (
    requestContext: WorkspaceRequestContext,
    explicitWorkspaceId: string | undefined,
  ) => Promise<string>;
  runSqlQuery: (
    context: AgentSqlContext,
    sql: string,
    requestUrl: string,
  ) => Promise<AgentSqlExecutionResult>;
  runSqlExecute: (
    context: AgentSqlContext,
    sql: string,
    requestUrl: string,
  ) => Promise<AgentSqlExecutionResult>;
  listUserWorkspacesWithStatsForSelectedWorkspace: (
    userId: string,
    selectedWorkspaceId: string | null,
  ) => Promise<ReadonlyArray<WorkspaceSummaryWithStats>>;
}>;

const DEFAULT_MCP_SERVER_DEPENDENCIES: McpServerDependencies = {
  nextReviewCard,
  revealAnswer,
  submitAgentReview,
  resolveAccessibleAgentWorkspaceId,
  runSqlQuery,
  runSqlExecute,
  listUserWorkspacesWithStatsForSelectedWorkspace,
};

/**
 * Per-request telemetry channel handed to the server by the entrypoint, which
 * builds one server per transport request (see
 * apps/backend/src/entrypoints/lambda-mcp.ts).
 *
 * `caller` labels the calling MCP client on the records this request emits. It
 * is the normalized request `User-Agent`: the `initialize` clientInfo is not
 * reachable here because the transport runs statelessly
 * (`sessionIdGenerator: undefined`), so a `tools/call` arrives as its own HTTP
 * request on a freshly built server that never saw the client's `initialize`.
 *
 * `recordInvokedTool` reports the tool a handler is about to run, so the
 * transport record names the invoked tool whatever the client's protocol
 * revision is: the `Mcp-Name` header only becomes REQUIRED in MCP revision
 * 2026-07-28 and most live callers are older. A batched request reports each
 * tool it runs, and the entrypoint keeps the last one so it still emits exactly
 * one record.
 */
export type McpRequestTelemetryChannel = Readonly<{
  caller: string | null;
  recordInvokedTool: (toolName: string) => void;
}>;

/**
 * Serializes compactly on purpose: a tool result is read by programs and
 * models, never rendered to a human, and indentation is not part of any MCP
 * revision's tool-result contract. Pretty-printing spent roughly half of every
 * result's characters on whitespace.
 */
function buildToolResultText(payload: unknown): string {
  return JSON.stringify(payload);
}

function buildToolResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: buildToolResultText(payload),
      },
    ],
  };
}

// Loads the caller's accessible workspaces (with stats) to embed under
// `error.details.workspaces` on WORKSPACE_SELECTION_REQUIRED.
async function buildWorkspaceSelectionDetails(
  connection: AuthenticatedMcpAccessToken,
  dependencies: McpServerDependencies,
): Promise<{ workspaces: ReadonlyArray<WorkspaceSummaryWithStats> }> {
  const workspaces = await dependencies.listUserWorkspacesWithStatsForSelectedWorkspace(
    connection.userId,
    connection.selectedWorkspaceId,
  );
  return { workspaces };
}

/**
 * Mirrors the HTTP agent error contract (apps/backend/src/server/app.ts
 * `app.onError`) on the MCP surface: known `HttpError`s pass through their
 * code/message/details with MCP-appropriate remediation instructions so the
 * model can self-correct its next tool call, while any unexpected error
 * returns a generic envelope (no driver/stack internals leak) and is captured
 * server-side. The generic-error branch reuses `app.onError`'s
 * `hasReportedBackendException` dedup guard so an Error a downstream layer
 * already captured-and-marked is not reported to Sentry twice.
 *
 * When the error is `WORKSPACE_SELECTION_REQUIRED`, the caller's accessible
 * workspaces (with stats) are embedded under `error.details.workspaces` so the
 * model can pick a `workspaceId` and retry the failed tool without a separate
 * list_workspaces round-trip.
 */
async function buildToolErrorResult(
  error: unknown,
  resourceUrl: string,
  connection: AuthenticatedMcpAccessToken,
  toolName: string,
  dependencies: McpServerDependencies,
): Promise<CallToolResult> {
  const userId = connection.userId;
  // A failing tool call is the frequent failure on this surface, so it carries
  // the id of the MCP transport request it ran in and joins to that request's
  // `mcp_request` record (see ./requestTelemetry). Null outside the transport.
  const requestId = getMcpRequestId();
  if (error instanceof HttpError) {
    // Mirror app.onError's shouldCaptureRequestFailureException: report only
    // genuine 5xx HttpErrors (e.g. createWorkspaceInvariantError HttpError(500),
    // DatabaseUnavailableError 503) to Sentry, dedup-guarded so a downstream
    // layer that already captured-and-marked is not reported twice. 4xx
    // HttpErrors stay un-reported on both surfaces. The client-facing envelope
    // below is unchanged.
    if (error.statusCode >= 500) {
      const normalizedError = normalizeCaughtError(error);
      if (hasReportedBackendException(normalizedError) === false) {
        captureBackendException({
          action: "request_failed",
          error: normalizedError,
          scope: createBackendObservationScope(
            "backend-api",
            requestId,
            `mcp/${toolName}`,
            "POST",
            userId,
            null,
            null,
            null,
            null,
            null,
            null,
          ),
          details: {
            statusCode: error.statusCode,
            code: error.code ?? "INTERNAL_ERROR",
            message: error.message,
            validationIssues: (error.details?.validationIssues ?? []).map((issue) => ({
              path: issue.path,
              code: issue.code,
            })),
          },
        });
      }
    }

    const code = error.code ?? "REQUEST_FAILED";
    const errorEnvelope = createAgentErrorEnvelope(
      resourceUrl,
      code,
      error.message,
      createAgentRemediationInstructions(error.code, error.statusCode, { surface: "mcp", toolName }),
      undefined,
      createPublicHttpErrorDetails(error.details) ?? undefined,
    );

    if (error.code === "WORKSPACE_SELECTION_REQUIRED") {
      // Best-effort enrichment: embed the caller's accessible workspaces so the
      // model can retry without a list_workspaces round-trip. If this secondary
      // lookup fails (transient DB error, pool exhaustion, a per-workspace
      // scoped transaction throwing), fall through to the base
      // WORKSPACE_SELECTION_REQUIRED envelope so the model still receives the
      // correct code + remediation text instead of an unhandled rejection.
      try {
        const workspaceSelectionDetails = await buildWorkspaceSelectionDetails(
          connection,
          dependencies,
        );
        return {
          isError: true,
          content: buildToolResult({
            ...errorEnvelope,
            error: {
              ...errorEnvelope.error,
              details: {
                ...errorEnvelope.error.details,
                ...workspaceSelectionDetails,
              },
            },
          }).content,
        };
      } catch (enrichmentError) {
        // Observe before discarding: a systematic enrichment failure (e.g. a
        // real DB outage) would otherwise be invisible to operators since the
        // user-facing envelope below is unchanged. Emit a low-severity
        // structured warning (CloudWatch record + Sentry warning) so the
        // failure is detectable without changing the client-facing result.
        const normalizedEnrichmentError = normalizeCaughtError(enrichmentError);
        captureBackendWarning({
          action: "mcp_workspace_selection_enrichment_failed",
          scope: createBackendObservationScope(
            "backend-api",
            requestId,
            `mcp/${toolName}`,
            "POST",
            userId,
            connection.selectedWorkspaceId,
            null,
            null,
            null,
            null,
            null,
          ),
          message: "MCP WORKSPACE_SELECTION_REQUIRED workspace enrichment failed; returning base envelope without details.workspaces.",
          details: {
            code: "WORKSPACE_SELECTION_REQUIRED",
            enrichmentPath: "mcp_workspace_selection_details",
            toolName,
            errorClass: normalizedEnrichmentError.name,
            errorMessage: normalizedEnrichmentError.message,
          },
        });
        return {
          isError: true,
          content: buildToolResult(errorEnvelope).content,
        };
      }
    }

    return {
      isError: true,
      content: buildToolResult(errorEnvelope).content,
    };
  }

  const normalizedError = normalizeCaughtError(error);
  if (hasReportedBackendException(normalizedError) === false) {
    captureBackendException({
      action: "request_failed",
      error: normalizedError,
      scope: createBackendObservationScope(
        "backend-api",
        requestId,
        `mcp/${toolName}`,
        "POST",
        userId,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
      details: {
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
        validationIssues: [],
      },
    });
  }

  return {
    isError: true,
    content: buildToolResult(
      createAgentErrorEnvelope(
        resourceUrl,
        "INTERNAL_ERROR",
        "Internal error executing tool",
        createAgentRemediationInstructions("INTERNAL_ERROR", 500, { surface: "mcp", toolName }),
      ),
    ).content,
  };
}

/**
 * Builds a stateless MCP server exposing every tool the shared registry
 * (`apps/backend/src/aiTools/toolRegistry`) lists for the `mcp` surface, each
 * scoped to the connection resolved from the OAuth or API-key Bearer token.
 *
 * The connection is captured per request (the Lambda creates one server per
 * call) so the tools never read ambient request state. `resourceUrl` is the
 * canonical MCP resource (`https://mcp.<domain>/mcp`) used to build the agent
 * envelope so the tool results share one contract with `/agent/sql/query` and
 * `/agent/sql/execute`. `websiteUrl` is the public marketing-site origin
 * (env-driven, see lambda-mcp.ts) surfaced in the MCP implementation metadata.
 * `iconUrl` is the absolute https URL of the served branded SVG icon
 * (`/icon.svg`), advertised as the server `icons` entry so spec-current MCP
 * clients and auto-ingesting catalogs can render the brand. `telemetry` is the
 * per-request observation channel (see `McpRequestTelemetryChannel`).
 */
export function createMcpServer(
  connection: AuthenticatedMcpAccessToken,
  resourceUrl: string,
  websiteUrl: string,
  iconUrl: string,
  telemetry: McpRequestTelemetryChannel,
): McpServer {
  return createMcpServerWithDependencies(
    connection,
    resourceUrl,
    websiteUrl,
    iconUrl,
    telemetry,
    DEFAULT_MCP_SERVER_DEPENDENCIES,
  );
}

export function createMcpServerWithDependencies(
  connection: AuthenticatedMcpAccessToken,
  resourceUrl: string,
  websiteUrl: string,
  iconUrl: string,
  telemetry: McpRequestTelemetryChannel,
  dependencies: McpServerDependencies,
): McpServer {
  const caller = telemetry.caller;
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      title: "Nibomo",
      websiteUrl,
      icons: [{ src: iconUrl, mimeType: "image/svg+xml", sizes: ["any"] }],
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  const toolContext: AgentToolContext = {
    userId: connection.userId,
    selectedWorkspaceId: connection.selectedWorkspaceId,
    connectionId: connection.connectionId,
    caller,
    sqlSurface: "mcp",
    resolveWorkspaceId: async (requestedWorkspaceId) =>
      dependencies.resolveAccessibleAgentWorkspaceId(
        {
          userId: connection.userId,
          selectedWorkspaceId: connection.selectedWorkspaceId,
        },
        requestedWorkspaceId,
      ),
    actions: {
      // Both SQL executors size their emitted agent envelope against this server's resource URL,
      // which is why the registry leaves them to the surface that owns it.
      runSqlQuery: async (sqlContext, sql) =>
        dependencies.runSqlQuery(sqlContext, sql, resourceUrl),
      runSqlExecute: async (sqlContext, sql) =>
        dependencies.runSqlExecute(sqlContext, sql, resourceUrl),
      listUserWorkspacesWithStatsForSelectedWorkspace:
        dependencies.listUserWorkspacesWithStatsForSelectedWorkspace,
      nextReviewCard: dependencies.nextReviewCard,
      revealAnswer: dependencies.revealAnswer,
      // This surface authenticates as an agent connection, so the review event is stored against
      // that connection's own replica, the same actor its SQL writes carry.
      submitAgentReview: async (reviewContext, request) => dependencies.submitAgentReview(
        reviewContext,
        request,
        resolveAgentConnectionReviewReplica,
        null,
      ),
    },
  };

  for (const spec of listAgentToolSpecsForSurface("mcp")) {
    const presentation = requireMcpToolPresentation(spec.name);
    server.registerTool(
      spec.name,
      {
        title: presentation.title,
        description: spec.description,
        _meta: presentation.maxResultSizeChars === null
          ? undefined
          : { "anthropic/maxResultSizeChars": presentation.maxResultSizeChars },
        inputSchema: spec.inputSchema,
        annotations: presentation.annotations,
      },
      async (rawInput: unknown): Promise<CallToolResult> => {
        telemetry.recordInvokedTool(spec.name);
        try {
          const result = await spec.execute(toolContext, rawInput);
          return buildToolResult(
            createAgentEnvelope(resourceUrl, result.data, result.instructions),
          );
        } catch (error) {
          return buildToolErrorResult(error, resourceUrl, connection, spec.name, dependencies);
        }
      },
    );
  }

  return server;
}
