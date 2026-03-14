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
import { classifyAIEndpointFailure } from "../chat/aiAvailabilityErrors";
import {
  parseChatTranscriptionUpload,
  transcribeChatAudioUpload,
  type ChatTranscriptionUpload,
} from "../chat/transcriptions";
import { HttpError } from "../errors";
import { loadRequestContextFromRequest } from "../server/requestContext";
import { parseJsonBody } from "../server/requestParsing";
import type { AppEnv } from "../app";

type ChatRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  transcribeAudioFn?: (upload: ChatTranscriptionUpload) => Promise<string>;
}>;

export function createChatRoutes(options: ChatRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const transcribeAudioFn = options.transcribeAudioFn ?? transcribeChatAudioUpload;

  app.post("/chat/local-turn", async (context) => {
    const requestId = randomUUID();

    try {
      await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
      const body = parseLocalChatRequestBody(await parseJsonBody(context.req.raw));
      return await streamLocalChatResponse(body, requestId);
    } catch (error) {
      if (error instanceof HttpError || error instanceof AuthError) {
        throw error;
      }

      const normalizedFailure = classifyAIEndpointFailure("chat", error, null);
      return createLocalChatErrorResponse(
        normalizedFailure.message,
        requestId,
        normalizedFailure.code,
        "local_turn_request",
      );
    }
  });

  app.post("/chat/transcriptions", async (context) => {
    await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const upload = await parseChatTranscriptionUpload(context.req.raw);
    const text = await transcribeAudioFn(upload);
    return context.json({ text });
  });

  app.post("/chat/local-turn/diagnostics", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(context.req.raw, options.allowedOrigins);
    const body = parseLocalChatDiagnosticsBody(await parseJsonBody(context.req.raw));
    logLocalChatDiagnostics(requestContext, body);
    return new Response(null, { status: 204 });
  });

  return app;
}
