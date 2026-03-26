/**
 * Legacy chat backend routes for old `/chat/turn` clients.
 * The backend-first `/chat` endpoints keep sessions and runs on the server and expose a different contract.
 * TODO: Remove this legacy module after most users have updated to app versions that use the new chat endpoints.
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { AuthError } from "../auth";
import {
  createAIChatErrorResponse,
  logAIChatDiagnostics,
  parseAIChatDiagnosticsBody,
  parseAIChatTurnRequestBody,
  streamAIChatResponse,
} from "../chat/legacy/http";
import { classifyAIEndpointFailure } from "../chat/legacy/aiAvailabilityErrors";
import { HttpError } from "../errors";
import { loadRequestContextFromRequest } from "../server/requestContext";
import { parseJsonBody } from "../server/requestParsing";
import type { AppEnv } from "../app";

type ChatLegacyRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  streamAIChatResponseFn?: typeof streamAIChatResponse;
}>;

/**
 * This legacy chat backend route factory mounts the old `/chat/turn` endpoints for pre-migration clients.
 * The backend-first `/chat` endpoints manage sessions, runs, and recovery differently on the server.
 * TODO: Remove this legacy function after most users have updated to app versions that use the new chat endpoints.
 */
export function createChatLegacyRoutes(options: ChatLegacyRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const streamAIChatResponseFn = options.streamAIChatResponseFn ?? streamAIChatResponse;

  app.post("/chat/turn", async (context) => {
    const requestId = randomUUID();

    try {
      const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
      const body = parseAIChatTurnRequestBody(await parseJsonBody(context.req.raw));
      return await streamAIChatResponseFn(body, requestId, requestContext, context.req.url);
    } catch (error) {
      if (error instanceof HttpError || error instanceof AuthError) {
        throw error;
      }

      const normalizedFailure = classifyAIEndpointFailure("chat", error, null);
      return createAIChatErrorResponse(
        normalizedFailure.message,
        requestId,
        normalizedFailure.code,
        "ai_chat_turn_request",
        error,
      );
    }
  });

  app.post("/chat/turn/diagnostics", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const body = parseAIChatDiagnosticsBody(await parseJsonBody(context.req.raw));
    logAIChatDiagnostics(requestContext, body);
    return new Response(null, { status: 204 });
  });

  return app;
}
