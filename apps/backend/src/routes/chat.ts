import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { AuthError } from "../auth";
import {
  createLocalChatErrorResponse,
  logLocalChatDiagnostics,
  parseLocalChatDiagnosticsBody,
  parseLocalChatRequestBody,
  streamLocalChatResponse,
} from "../chat/http";
import { HttpError } from "../errors";
import { loadRequestContextFromRequest } from "../server/requestContext";
import { parseJsonBody } from "../server/requestParsing";
import type { AppEnv } from "../app";

type ChatRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createChatRoutes(options: ChatRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/chat/local-turn", async (context) => {
    const requestId = randomUUID();

    try {
      await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      const body = parseLocalChatRequestBody(await parseJsonBody(context.req.raw));
      return await streamLocalChatResponse(body, requestId);
    } catch (error) {
      if (error instanceof HttpError || error instanceof AuthError) {
        throw error;
      }

      return createLocalChatErrorResponse(
        getInternalErrorMessage(error),
        requestId,
        "LOCAL_CHAT_REQUEST_FAILED",
        "local_turn_request",
      );
    }
  });

  app.post("/chat/local-turn/diagnostics", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const body = parseLocalChatDiagnosticsBody(await parseJsonBody(context.req.raw));
    logLocalChatDiagnostics(requestContext, body);
    return new Response(null, { status: 204 });
  });

  return app;
}
