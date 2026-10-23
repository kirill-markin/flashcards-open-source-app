import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import {
  nextReviewCard,
  resolveAgentConnectionReviewReplica,
  revealAnswer,
  submitAgentReview,
} from "../agent/reviews";
import { runSqlExecute, runSqlQuery } from "../aiTools/agentSql";
import type { AgentSqlResultMeasure } from "../aiTools/agentSql/resultBudget";
import type { AgentSqlContext, AgentSqlExecutionResult } from "../aiTools/agentSql/shared";
import {
  ASSISTANT_BEHAVIOUR_RULE_LINES,
  ASSISTANT_PRODUCT_DESCRIPTION,
} from "../aiTools/toolContract/assistantContract";
import { createAgentToolErrorMessage } from "../aiTools/toolContract/remediationInstructions";
import {
  SQL_EXECUTE_TOOL_NAME,
  SQL_QUERY_TOOL_NAME,
} from "../aiTools/toolContract/sqlToolContract";
import { MAX_SQL_RESULT_CHARS } from "../aiTools/toolContract/sqlToolLimits";
import { USAGE_LIMITS_TOOL_NAME } from "../aiTools/toolContract/usageToolContract";
import { loadAiUsageStatus } from "../aiUsage";
import {
  buildAgentSqlToolPayload,
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
import { getMcpRequestId } from "./requestTelemetry";
import { MAX_MCP_TOOL_INPUT_ELEMENTS } from "./requestLimits";
import { requireMcpToolOutputSchema } from "./outputSchemas";
import { createPublicHttpErrorDetails, HttpError, type PublicHttpErrorDetails } from "../shared/errors";
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
 * Server instructions carry only what every conversation needs; SQL detail lives in the SQL tool
 * descriptions and everything else in `get_guide` topics.
 */
const SERVER_INSTRUCTIONS = [
  ASSISTANT_PRODUCT_DESCRIPTION,
  ...ASSISTANT_BEHAVIOUR_RULE_LINES,
  "Call list_workspaces to pick a workspaceId, or omit it for the selected default.",
  "Hard rules: front_text is a short recall prompt, never the answer; every new card needs at least one tag, reusing existing workspace tags; check for duplicates with sql_query before creating.",
  "Read get_guide(card_authoring) before authoring cards and get_guide(bulk_authoring) before a large write job.",
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
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
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
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    maxResultSizeChars: null,
  },
  // get_guide returns static contract text: no workspace is read, nothing is written, and the same
  // topic always returns the same body.
  [GET_GUIDE_TOOL_NAME]: {
    title: "Get flashcards usage guide",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    maxResultSizeChars: null,
  },
  [NEXT_REVIEW_CARD_TOOL_NAME]: {
    title: "Next flashcard question",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    maxResultSizeChars: null,
  },
  [REVEAL_ANSWER_TOOL_NAME]: {
    title: "Reveal flashcard answer",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
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
  // get_usage_limits reads the caller's own billing and metering rows and writes nothing a caller can
  // see. idempotentHint is true in the sense the hint carries - repeating the call has no additional
  // effect - even though the answer moves as AI is spent.
  [USAGE_LIMITS_TOOL_NAME]: {
    title: "Get AI usage and limits",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
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
    measureResultChars: AgentSqlResultMeasure,
  ) => Promise<AgentSqlExecutionResult>;
  runSqlExecute: (
    context: AgentSqlContext,
    sql: string,
    measureResultChars: AgentSqlResultMeasure,
  ) => Promise<AgentSqlExecutionResult>;
  listUserWorkspacesWithStatsForSelectedWorkspace: (
    userId: string,
    selectedWorkspaceId: string | null,
  ) => Promise<ReadonlyArray<WorkspaceSummaryWithStats>>;
  loadAiUsageStatus: typeof loadAiUsageStatus;
}>;

const DEFAULT_MCP_SERVER_DEPENDENCIES: McpServerDependencies = {
  nextReviewCard,
  revealAnswer,
  submitAgentReview,
  resolveAccessibleAgentWorkspaceId,
  runSqlQuery,
  runSqlExecute,
  listUserWorkspacesWithStatsForSelectedWorkspace,
  loadAiUsageStatus,
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
 *
 * `recordToolOutcome` reports, once per handler run, whether the tool answered
 * with an error result and the code that result carries. A failed tool call is
 * still a successful JSON-RPC response, so the transport status cannot tell it
 * apart. Only the code is reported, never the message, which can quote
 * flashcard content.
 */
export type McpRequestTelemetryChannel = Readonly<{
  caller: string | null;
  recordInvokedTool: (toolName: string) => void;
  recordToolOutcome: (outcome: McpToolOutcome) => void;
}>;

export type McpToolOutcome = Readonly<
  | { isError: false; errorCode: null }
  | { isError: true; errorCode: string }
>;

/** The `error.code` a failed tool call's envelope sends to the client. */
function getToolErrorCode(error: unknown): string {
  return error instanceof HttpError ? error.code ?? "REQUEST_FAILED" : "INTERNAL_ERROR";
}

/**
 * Serializes compactly on purpose: a tool result is read by programs and
 * models, never rendered to a human, and indentation is not part of any MCP
 * revision's tool-result contract. Pretty-printing spent roughly half of every
 * result's characters on whitespace.
 */
function buildToolResultText(payload: unknown): string {
  return JSON.stringify(payload);
}

function buildToolResult(payload: Readonly<Record<string, unknown>>): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: buildToolResultText(payload),
      },
    ],
  };
}

/**
 * A tool result carries facts only, unlike the REST agent envelope it shares its `ok`, `data` and
 * `error` fields with: what to do with them is in the tool descriptions and `get_guide` topics, and a
 * failure's remediation is part of `error.message`.
 */
type ToolSuccessEnvelope = Readonly<{
  ok: true;
  data: unknown;
}>;

type ToolErrorDetails = PublicHttpErrorDetails & Readonly<{
  workspaces?: ReadonlyArray<WorkspaceSummaryWithStats>;
}>;

type ToolErrorEnvelope = Readonly<{
  ok: false;
  error: Readonly<{
    code: string;
    message: string;
    details?: ToolErrorDetails;
  }>;
}>;

function createToolSuccessEnvelope(data: unknown): ToolSuccessEnvelope {
  return { ok: true, data };
}

function createToolErrorEnvelope(
  code: string,
  message: string,
  details: ToolErrorDetails | undefined,
): ToolErrorEnvelope {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/**
 * Measures a SQL result as this server emits it, payload augmentation included, so the result-size
 * budget binds the text a client actually receives.
 */
function createSqlToolResultMeasure(workspaceId: string): AgentSqlResultMeasure {
  return (result) => buildToolResultText(
    createToolSuccessEnvelope(buildAgentSqlToolPayload(result.data, workspaceId)),
  ).length;
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
 * code/message/details, the message followed by MCP-worded remediation so the
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
 *
 * `code` is `getToolErrorCode(error)`, taken once by the handler so the
 * envelope and the `mcp_request` record cannot disagree.
 */
async function buildToolErrorResult(
  error: unknown,
  code: string,
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

    const message = createAgentToolErrorMessage(
      error.message,
      error.code,
      error.statusCode,
      { surface: "mcp", toolName },
    );
    const details = createPublicHttpErrorDetails(error.details) ?? undefined;
    const errorEnvelope = createToolErrorEnvelope(code, message, details);

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
          content: buildToolResult(createToolErrorEnvelope(code, message, {
            ...details,
            ...workspaceSelectionDetails,
          })).content,
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
    content: buildToolResult(createToolErrorEnvelope(
      code,
      createAgentToolErrorMessage("Internal error executing tool", "INTERNAL_ERROR", 500, { surface: "mcp", toolName }),
      undefined,
    )).content,
  };
}

/**
 * Builds a stateless MCP server exposing every tool the shared registry
 * (`apps/backend/src/aiTools/toolRegistry`) lists for the `mcp` surface, each
 * scoped to the connection resolved from the OAuth or API-key Bearer token.
 *
 * The connection is captured per request (the Lambda creates one server per
 * call) so the tools never read ambient request state. `websiteUrl` is the
 * public marketing-site origin (env-driven, see lambda-mcp.ts) surfaced in the
 * MCP implementation metadata.
 * `iconUrl` is the absolute https URL of the served branded SVG icon
 * (`/icon.svg`), advertised as the server `icons` entry so spec-current MCP
 * clients and auto-ingesting catalogs can render the brand. `telemetry` is the
 * per-request observation channel (see `McpRequestTelemetryChannel`).
 */
export function createMcpServer(
  connection: AuthenticatedMcpAccessToken,
  websiteUrl: string,
  iconUrl: string,
  telemetry: McpRequestTelemetryChannel,
): McpServer {
  return createMcpServerWithDependencies(
    connection,
    websiteUrl,
    iconUrl,
    telemetry,
    DEFAULT_MCP_SERVER_DEPENDENCIES,
  );
}

export function createMcpServerWithDependencies(
  connection: AuthenticatedMcpAccessToken,
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
      title: "Nibomo Flashcards",
      websiteUrl,
      icons: [{ src: iconUrl, mimeType: "image/svg+xml", sizes: ["any"] }],
    },
    {
      instructions: SERVER_INSTRUCTIONS,
      maxToolInputElements: MAX_MCP_TOOL_INPUT_ELEMENTS,
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
      // Both SQL executors size the result this server emits, which is why the registry leaves them to
      // the surface that owns it.
      runSqlQuery: async (sqlContext, sql) =>
        dependencies.runSqlQuery(sqlContext, sql, createSqlToolResultMeasure(sqlContext.workspaceId)),
      runSqlExecute: async (sqlContext, sql) =>
        dependencies.runSqlExecute(sqlContext, sql, createSqlToolResultMeasure(sqlContext.workspaceId)),
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
      // Every caller here holds an agent connection, and a connection can only be created from a
      // signed-in human session: `requireHumanManagedConnectionAccess`
      // (apps/backend/src/routes/workspaces/connectionAccess.ts) refuses a guest transport with
      // ACCOUNT_SIGN_IN_REQUIRED. So this surface has no guest to distinguish and binds the account
      // kind rather than reading one. Letting a guest hold a connection would have to change this.
      loadAiUsageStatus: async (userId, now) => dependencies.loadAiUsageStatus(
        userId,
        "account",
        now,
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
        outputSchema: requireMcpToolOutputSchema(spec.name),
        annotations: { ...presentation.annotations, title: presentation.title },
      },
      async (rawInput: unknown): Promise<CallToolResult> => {
        telemetry.recordInvokedTool(spec.name);
        try {
          const result = await spec.execute(toolContext, rawInput);
          const toolResult: CallToolResult = {
            ...buildToolResult(createToolSuccessEnvelope(result.data)),
            structuredContent: { data: result.data },
          };
          telemetry.recordToolOutcome({ isError: false, errorCode: null });
          return toolResult;
        } catch (error) {
          const errorCode = getToolErrorCode(error);
          telemetry.recordToolOutcome({ isError: true, errorCode });
          return buildToolErrorResult(
            error,
            errorCode,
            connection,
            spec.name,
            dependencies,
          );
        }
      },
    );
  }

  return server;
}
