import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeAgentSql } from "../aiTools/agentSql";
import { OPENAI_SQL_TOOL, SQL_TOOL_NAME } from "../aiTools/toolContract/sqlToolContract";
import { requireAccessibleSelectedWorkspaceId } from "../server/requestContext";
import { createAgentEnvelope, createAgentErrorEnvelope } from "../agent/envelope";
import { createAgentInstructions } from "../server/app";
import { createPublicHttpErrorDetails, HttpError } from "../shared/errors";
import {
  captureBackendException,
  createBackendObservationScope,
  normalizeCaughtError,
} from "../observability/sentry";
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
const SQL_TOOL_DESCRIPTION = `${OPENAI_SQL_TOOL.description} ${FRONT_BACK_CONTRACT}`;

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
 * Mirrors the HTTP agent error contract (apps/backend/src/server/app.ts
 * `app.onError`) on the MCP surface: known `HttpError`s pass through their
 * code/message/details and tailored remediation instructions so the model can
 * self-correct exactly as it does against `/agent/sql`, while any unexpected
 * error returns a generic envelope (no driver/stack internals leak) and is
 * captured server-side.
 */
function buildToolErrorResult(
  error: unknown,
  resourceUrl: string,
  userId: string,
): CallToolResult {
  if (error instanceof HttpError) {
    const code = error.code ?? "REQUEST_FAILED";
    return {
      isError: true,
      content: buildToolResult(
        createAgentErrorEnvelope(
          resourceUrl,
          code,
          error.message,
          createAgentInstructions(error.code, error.statusCode),
          undefined,
          createPublicHttpErrorDetails(error.details) ?? undefined,
        ),
      ).content,
    };
  }

  captureBackendException({
    action: "request_failed",
    error: normalizeCaughtError(error),
    scope: createBackendObservationScope(
      "backend-api",
      null,
      "mcp/sql",
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

  return {
    isError: true,
    content: buildToolResult(
      createAgentErrorEnvelope(
        resourceUrl,
        "INTERNAL_ERROR",
        "Internal error executing SQL",
        createAgentInstructions("INTERNAL_ERROR", 500),
      ),
    ).content,
  };
}

/**
 * Builds a stateless MCP server exposing a single `sql` tool that forwards the
 * SQL string to the backend `executeAgentSql` 1:1 (full read + write), scoped
 * to the connection resolved from the OAuth Bearer access token.
 *
 * The connection is captured per request (the Lambda creates one server per
 * call) so the tool never reads ambient request state. `resourceUrl` is the
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
      },
    },
    async ({ sql }): Promise<CallToolResult> => {
      try {
        const workspaceId = await requireAccessibleSelectedWorkspaceId({
          userId: connection.userId,
          selectedWorkspaceId: connection.selectedWorkspaceId,
        });
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
        return buildToolErrorResult(error, resourceUrl, connection.userId);
      }
    },
  );

  return server;
}
