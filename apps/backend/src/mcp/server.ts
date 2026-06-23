import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runSqlExecute, runSqlQuery } from "../aiTools/agentSql";
import {
  FRONT_BACK_CONTRACT,
  SQL_EXECUTE_TOOL_DESCRIPTION,
  SQL_EXECUTE_TOOL_NAME,
  SQL_QUERY_TOOL_DESCRIPTION,
  SQL_QUERY_TOOL_NAME,
} from "../aiTools/toolContract/sqlToolContract";
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
 * Descriptions for the split MCP `sql_query` (read-only) and `sql_execute`
 * (write) tools. Reuse the published split tool-call descriptions so the MCP
 * surface and the in-app AI agent stay on one contract, then append the shared
 * card-side contract and the workspaceId argument hint.
 */
const WORKSPACE_ID_ARGUMENT_HINT =
  "Optional workspaceId targets a specific workspace you belong to; omit it to use your currently selected workspace. Call the list_workspaces tool to get the selectable workspace ids (and their card counts and last activity) for this workspaceId argument.";
const SQL_QUERY_MCP_TOOL_DESCRIPTION = `${SQL_QUERY_TOOL_DESCRIPTION} ${FRONT_BACK_CONTRACT} ${WORKSPACE_ID_ARGUMENT_HINT}`;
const SQL_EXECUTE_MCP_TOOL_DESCRIPTION = `${SQL_EXECUTE_TOOL_DESCRIPTION} ${FRONT_BACK_CONTRACT} ${WORKSPACE_ID_ARGUMENT_HINT}`;

const SERVER_INSTRUCTIONS =
  "Call list_workspaces first to pick a workspaceId (or omit it to use the selected default). Use sql_query for reads (SHOW TABLES, DESCRIBE, SHOW COLUMNS, SELECT) and sql_execute for writes (INSERT, UPDATE, DELETE). The dialect is not full PostgreSQL. front_text is only a question or review prompt and never holds the answer; back_text holds the answer.";

const LIST_WORKSPACES_TOOL_NAME = "list_workspaces";
const LIST_WORKSPACES_TOOL_DESCRIPTION =
  "Lists the workspaces you can access, each with its workspaceId, name, active card count, last activity timestamp, and an isSelected flag marking your current default workspace. Use the returned workspaceId values for the sql_query and sql_execute workspaceId argument; pick the isSelected one to stay on the default.";

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
 * authenticates via an OAuth Bearer token and only has the split `sql_query`
 * and `sql_execute` tools (plus `list_workspaces`): it cannot set an `ApiKey`
 * Authorization header or call any `/v1/agent/*` route. So this phrases every
 * remediation in terms the MCP client can act on (re-call the same tool, or
 * re-authorize the connector) instead of pointing at HTTP endpoints and ApiKey
 * auth it has no way to use. `toolName` names the failing tool so the model
 * retries the correct one.
 */
function createMcpToolInstructions(code: string | null, statusCode: number, toolName: string): string {
  switch (code) {
    case "QUERY_INVALID_SQL":
    case "QUERY_UNSUPPORTED_SYNTAX":
      return `Fix the sql string using error.message and any error.details.validationIssues, then call the ${toolName} tool again.`;
    case "WORKSPACE_SELECTION_REQUIRED":
      return `This connection has no selected workspace. Call the list_workspaces tool to see the workspaces you can access (also embedded under error.details.workspaces when available), then call the ${toolName} tool again with the workspaceId argument set to the one you want.`;
    case "DATABASE_COMMIT_OUTCOME_UNKNOWN":
      return `The previous mutation's outcome could not be confirmed. Do not blindly re-run it: first call sql_query with a SELECT to check whether the change already applied, and only call the ${toolName} tool again if the change is confirmed absent.`;
    case "SERVICE_UNAVAILABLE":
      return `The service is temporarily unavailable. Retry the same ${toolName} tool call after a short delay without changing the request.`;
  }

  if (statusCode >= 500) {
    return `Retry the ${toolName} tool once; if it fails again treat it as a server-side error and stop changing the request.`;
  }

  if (statusCode >= 400) {
    return `Fix the request using error.message and any error.details.validationIssues, then call the ${toolName} tool again.`;
  }

  return `Fix the request using error.message and any error.details.validationIssues, then call the ${toolName} tool again.`;
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
      createMcpToolInstructions(error.code, error.statusCode, toolName),
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
        createMcpToolInstructions("INTERNAL_ERROR", 500, toolName),
      ),
    ).content,
  };
}

const LIST_WORKSPACES_RESULT_INSTRUCTIONS =
  "These are the workspaces you can access. Each workspace has a workspaceId, name, cardCount (active cards), lastActivityAt (most recent card edit or review, or null), and isSelected (your current default). To target a specific one, pass its workspaceId to sql_query or sql_execute; the isSelected workspace is used by default when you omit workspaceId. Prefer the most active workspace (highest cardCount or most recent lastActivityAt) when the user has not told you which to use.";

/**
 * Builds a stateless MCP server exposing a read-only `sql_query` tool and a
 * write `sql_execute` tool, each forwarding the SQL string to the shared
 * backend `runSqlQuery` / `runSqlExecute` execution functions, plus a
 * `list_workspaces` tool that returns the caller's accessible workspaces with
 * stats, all scoped to the connection resolved from the OAuth Bearer access
 * token.
 *
 * The connection is captured per request (the Lambda creates one server per
 * call) so the tools never read ambient request state. `resourceUrl` is the
 * canonical MCP resource (`https://mcp.<domain>/mcp`) used to build the agent
 * envelope so the tool results share one contract with `/agent/sql/query` and
 * `/agent/sql/execute`. `websiteUrl` is the public marketing-site origin
 * (env-driven, see lambda-mcp.ts) surfaced in the MCP implementation metadata.
 */
export function createMcpServer(
  connection: AuthenticatedMcpAccessToken,
  resourceUrl: string,
  websiteUrl: string,
): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      title: "Flashcards Open Source App",
      websiteUrl,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  async function resolveWorkspaceId(requestedWorkspaceId: string | undefined): Promise<string> {
    return resolveAccessibleMcpWorkspaceId(
      {
        userId: connection.userId,
        selectedWorkspaceId: connection.selectedWorkspaceId,
      },
      requestedWorkspaceId,
    );
  }

  server.registerTool(
    SQL_QUERY_TOOL_NAME,
    {
      title: "Flashcards SQL query (read-only)",
      description: SQL_QUERY_MCP_TOOL_DESCRIPTION,
      inputSchema: {
        sql: z.string().trim().min(1),
        workspaceId: z.string().uuid().optional(),
      },
      // sql_query only reads our own database. openWorldHint is false because
      // it acts only within our own closed database domain; idempotentHint is
      // true because repeating the same read has no additional effect.
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ sql, workspaceId: requestedWorkspaceId }): Promise<CallToolResult> => {
      try {
        const workspaceId = await resolveWorkspaceId(requestedWorkspaceId);
        const result = await runSqlQuery({
          userId: connection.userId,
          workspaceId,
          selectedWorkspaceId: connection.selectedWorkspaceId,
          connectionId: connection.connectionId,
        }, sql);

        return buildToolResult(
          createAgentEnvelope(resourceUrl, result.data, result.instructions),
        );
      } catch (error) {
        return buildToolErrorResult(error, resourceUrl, connection, SQL_QUERY_TOOL_NAME);
      }
    },
  );

  server.registerTool(
    SQL_EXECUTE_TOOL_NAME,
    {
      title: "Flashcards SQL execute (write)",
      description: SQL_EXECUTE_MCP_TOOL_DESCRIPTION,
      inputSchema: {
        sql: z.string().trim().min(1),
        workspaceId: z.string().uuid().optional(),
      },
      // sql_execute mutates our own database. Spell out the (MCP-default)
      // non-read-only + destructive hints explicitly; openWorldHint is false
      // because it acts only within our own closed database domain.
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ sql, workspaceId: requestedWorkspaceId }): Promise<CallToolResult> => {
      try {
        const workspaceId = await resolveWorkspaceId(requestedWorkspaceId);
        const result = await runSqlExecute({
          userId: connection.userId,
          workspaceId,
          selectedWorkspaceId: connection.selectedWorkspaceId,
          connectionId: connection.connectionId,
        }, sql);

        return buildToolResult(
          createAgentEnvelope(resourceUrl, result.data, result.instructions),
        );
      } catch (error) {
        return buildToolErrorResult(error, resourceUrl, connection, SQL_EXECUTE_TOOL_NAME);
      }
    },
  );

  server.registerTool(
    LIST_WORKSPACES_TOOL_NAME,
    {
      title: "List flashcards workspaces",
      description: LIST_WORKSPACES_TOOL_DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
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
