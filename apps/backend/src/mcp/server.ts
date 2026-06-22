import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeAgentSql } from "../aiTools/agentSql";
import { OPENAI_SQL_TOOL, SQL_TOOL_NAME } from "../aiTools/toolContract/sqlToolContract";
import { resolveAccessibleMcpWorkspaceId } from "../server/requestContext";
import { createAgentEnvelope, createAgentErrorEnvelope } from "../agent/envelope";
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
 * Flashcard side contract, mandatory across all clients and APIs: `front_text`
 * is only a question/review prompt, never the answer, and `back_text` holds the
 * answer. Embed it in the tool description so the model writes correct cards.
 */
const FRONT_BACK_CONTRACT =
  "Card side contract: front_text is only a question or review prompt and must never contain the answer; back_text contains the answer, optionally with a concrete example (prefer a fenced markdown code block when helpful).";

/**
 * Description for the MCP `sql` tool. Reuses the published OpenAI tool-call
 * description so the MCP surface and the in-app AI agent stay on one contract,
 * then appends the card-side contract that all clients must follow.
 */
const baseDescription = OPENAI_SQL_TOOL.description ?? "";
if (baseDescription === "") {
  throw new Error("OPENAI_SQL_TOOL.description must be set for the MCP sql tool");
}
const WORKSPACE_ID_ARGUMENT_HINT =
  "Optional workspaceId targets a specific workspace you belong to; omit it to use your currently selected workspace. Call the list_workspaces tool to get the selectable workspace ids (and their card counts and last activity) for this workspaceId argument.";
const SQL_TOOL_DESCRIPTION = `${baseDescription} ${FRONT_BACK_CONTRACT} ${WORKSPACE_ID_ARGUMENT_HINT}`;

const LIST_WORKSPACES_TOOL_NAME = "list_workspaces";
const LIST_WORKSPACES_TOOL_DESCRIPTION =
  "Lists the workspaces you can access, each with its workspaceId, name, active card count, last activity timestamp, and an isSelected flag marking your current default workspace. Use the returned workspaceId values for the sql tool's workspaceId argument; pick the isSelected one to stay on the default.";

function buildToolResultText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
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

/**
 * MCP-surface remediation instructions. Unlike the HTTP agent surface
 * (`createAgentInstructions` in apps/backend/src/server/app.ts), an MCP client
 * authenticates via an OAuth Bearer token and only has the single `sql` tool:
 * it cannot set an `ApiKey` Authorization header or call any `/v1/agent/*`
 * route. So this phrases every remediation in terms the MCP client can act on
 * (re-call the `sql` tool, or re-authorize the connector) instead of pointing
 * at HTTP endpoints and ApiKey auth it has no way to use.
 */
function createMcpToolInstructions(code: string | null, statusCode: number): string {
  switch (code) {
    case "QUERY_INVALID_SQL":
    case "QUERY_UNSUPPORTED_SYNTAX":
      return "Fix the sql string using error.message and any error.details.validationIssues, then call the sql tool again.";
    case "WORKSPACE_SELECTION_REQUIRED":
      return "This connection has no selected workspace. Call the list_workspaces tool to see the workspaces you can access (also embedded under error.details.workspaces when available), then call the sql tool again with the workspaceId argument set to the one you want.";
    case "DATABASE_COMMIT_OUTCOME_UNKNOWN":
      return "The previous mutation's outcome could not be confirmed. Do not blindly re-run it: first SELECT to check whether the change already applied, and only call the sql tool again if the change is confirmed absent.";
    case "SERVICE_UNAVAILABLE":
      return "The service is temporarily unavailable. Retry the same sql tool call after a short delay without changing the request.";
  }

  if (statusCode >= 500) {
    return "Retry the sql tool once; if it fails again treat it as a server-side error and stop changing the request.";
  }

  if (statusCode >= 400) {
    return "Fix the request using error.message and any error.details.validationIssues, then call the sql tool again.";
  }

  return "Fix the request using error.message and any error.details.validationIssues, then call the sql tool again.";
}

// Loads the caller's accessible workspaces (with stats) to embed under
// `error.details.workspaces` on WORKSPACE_SELECTION_REQUIRED.
async function buildWorkspaceSelectionDetails(
  connection: AuthenticatedMcpAccessToken,
): Promise<{ workspaces: ReadonlyArray<WorkspaceSummaryWithStats> }> {
  const workspaces = await listUserWorkspacesWithStatsForSelectedWorkspace(
    connection.userId,
    connection.selectedWorkspaceId,
  );
  return { workspaces };
}

/**
 * Mirrors the HTTP agent error contract (apps/backend/src/server/app.ts
 * `app.onError`) on the MCP surface: known `HttpError`s pass through their
 * code/message/details with MCP-appropriate remediation instructions so the
 * model can self-correct over the `sql` tool, while any unexpected error
 * returns a generic envelope (no driver/stack internals leak) and is captured
 * server-side. The generic-error branch reuses `app.onError`'s
 * `hasReportedBackendException` dedup guard so an Error a downstream layer
 * already captured-and-marked is not reported to Sentry twice.
 *
 * When the error is `WORKSPACE_SELECTION_REQUIRED`, the caller's accessible
 * workspaces (with stats) are embedded under `error.details.workspaces` so the
 * model can pick a `workspaceId` and retry the sql tool without a separate
 * list_workspaces round-trip.
 */
async function buildToolErrorResult(
  error: unknown,
  resourceUrl: string,
  connection: AuthenticatedMcpAccessToken,
  toolName: string,
): Promise<CallToolResult> {
  const userId = connection.userId;
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
            null,
            `mcp/${toolName}`,
            "POST",
            userId,
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
      createMcpToolInstructions(error.code, error.statusCode),
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
        const workspaceSelectionDetails = await buildWorkspaceSelectionDetails(connection);
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
            null,
            `mcp/${toolName}`,
            "POST",
            userId,
            connection.selectedWorkspaceId,
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
        null,
        `mcp/${toolName}`,
        "POST",
        userId,
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
        "Internal error executing SQL",
        createMcpToolInstructions("INTERNAL_ERROR", 500),
      ),
    ).content,
  };
}

const LIST_WORKSPACES_RESULT_INSTRUCTIONS =
  "These are the workspaces you can access. Each workspace has a workspaceId, name, cardCount (active cards), lastActivityAt (most recent card edit or review, or null), and isSelected (your current default). To query a specific one, call the sql tool with its workspaceId; the isSelected workspace is used by default when you omit workspaceId. Prefer the most active workspace (highest cardCount or most recent lastActivityAt) when the user has not told you which to use.";

/**
 * Builds a stateless MCP server exposing a `sql` tool that forwards the SQL
 * string to the backend `executeAgentSql` 1:1 (full read + write) and a
 * `list_workspaces` tool that returns the caller's accessible workspaces with
 * stats, both scoped to the connection resolved from the OAuth Bearer access
 * token.
 *
 * The connection is captured per request (the Lambda creates one server per
 * call) so the tools never read ambient request state. `resourceUrl` is the
 * canonical MCP resource (`https://mcp.<domain>/mcp`) used to build the agent
 * envelope so the tool result shares one contract with `/agent/sql`.
 */
export function createMcpServer(
  connection: AuthenticatedMcpAccessToken,
  resourceUrl: string,
): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    SQL_TOOL_NAME,
    {
      title: "Flashcards SQL",
      description: SQL_TOOL_DESCRIPTION,
      inputSchema: {
        sql: z.string().trim().min(1),
        workspaceId: z.string().uuid().optional(),
      },
    },
    async ({ sql, workspaceId: requestedWorkspaceId }): Promise<CallToolResult> => {
      try {
        const workspaceId = await resolveAccessibleMcpWorkspaceId(
          {
            userId: connection.userId,
            selectedWorkspaceId: connection.selectedWorkspaceId,
          },
          requestedWorkspaceId,
        );
        const result = await executeAgentSql(
          {
            userId: connection.userId,
            workspaceId,
            selectedWorkspaceId: connection.selectedWorkspaceId,
            connectionId: connection.connectionId,
          },
          sql,
        );

        return buildToolResult(
          createAgentEnvelope(resourceUrl, result.data, result.instructions),
        );
      } catch (error) {
        return buildToolErrorResult(error, resourceUrl, connection, SQL_TOOL_NAME);
      }
    },
  );

  server.registerTool(
    LIST_WORKSPACES_TOOL_NAME,
    {
      title: "List flashcards workspaces",
      description: LIST_WORKSPACES_TOOL_DESCRIPTION,
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      try {
        const workspaces = await listUserWorkspacesWithStatsForSelectedWorkspace(
          connection.userId,
          connection.selectedWorkspaceId,
        );

        return buildToolResult(
          createAgentEnvelope(
            resourceUrl,
            { workspaces },
            LIST_WORKSPACES_RESULT_INSTRUCTIONS,
          ),
        );
      } catch (error) {
        return buildToolErrorResult(error, resourceUrl, connection, LIST_WORKSPACES_TOOL_NAME);
      }
    },
  );

  return server;
}
