import { PassThrough, Readable } from "node:stream";
import { Hono } from "hono";
import { runLiveStream } from "../chat/live";
import { createChatLiveErrorResponse } from "../chat/live/errors";
import {
  getLiveAuthorizationScheme,
  handleLiveRequest,
  readOptionalChatRequestIdHeader,
  type LiveStreamParams,
} from "../chat/live/request";
import {
  addBackendBreadcrumb,
  captureBackendException,
  continueBackendTrace,
  createBackendObservationScope,
  normalizeCaughtError,
  startBackendSpan,
} from "../observability/sentry";
import type { AppEnv } from "../server/appEnv";

/**
 * The live chat stream served by this Node process, which standalone mounts where AWS has the chat-live
 * Lambda (entrypoints/lambda-chat-live.ts). `CHAT_LIVE_URL` must name this route.
 */
const openLiveStreams = new Set<PassThrough>();

/**
 * Ends every open stream, so a stopping server can close. A client sees its stream end without
 * `run_terminal` and attaches again from its cursor, as after the Lambda's connection limit.
 */
export function endOpenChatLiveStreams(): void {
  for (const stream of openLiveStreams) {
    stream.end();
  }
}

export function createChatLiveRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/chat/live", async (context) => {
    const requestId = context.get("requestId");
    const url = new URL(context.req.url);
    const authorizationHeader = context.req.header("authorization");
    const clientPlatform = context.req.header("x-client-platform") ?? null;
    const clientVersion = context.req.header("x-client-version") ?? null;
    const clientRequestId = readOptionalChatRequestIdHeader(context.req.raw.headers) ?? null;
    const queryDetails = {
      path: url.pathname,
      hasToken: url.searchParams.has("token"),
      hasWorkspaceId: url.searchParams.has("workspaceId"),
      origin: context.req.header("origin") ?? null,
      authScheme: getLiveAuthorizationScheme(authorizationHeader),
      resumeAttemptId: context.req.header("x-chat-resume-attempt-id") ?? null,
      clientPlatform,
      clientVersion,
    };

    let params: LiveStreamParams;
    try {
      params = await handleLiveRequest(url, authorizationHeader, context.req.raw.headers);
    } catch (error) {
      const errorResponse = createChatLiveErrorResponse(error, requestId);
      const event = {
        action: "chat_live_request_error",
        scope: createBackendObservationScope(
          "chat-live", requestId, url.pathname, "GET", null, null, clientRequestId,
          url.searchParams.get("runId"), url.searchParams.get("sessionId"), clientVersion, clientPlatform,
        ),
        details: {
          ...queryDetails,
          statusCode: errorResponse.statusCode,
          sessionId: url.searchParams.get("sessionId"),
          runId: url.searchParams.get("runId"),
          afterCursor: url.searchParams.get("afterCursor"),
          clientRequestId,
          code: errorResponse.body.code,
          message: error instanceof Error ? error.message : String(error),
        },
      } as const;
      if (errorResponse.statusCode >= 500) {
        captureBackendException({ ...event, error: normalizeCaughtError(error) });
      } else {
        addBackendBreadcrumb(event);
      }
      return context.json(errorResponse.body, errorResponse.statusCode);
    }

    const streamScope = createBackendObservationScope(
      "chat-live", requestId, url.pathname, "GET", params.userId, params.workspaceId,
      params.clientRequestId ?? null, params.runId, params.sessionId, clientVersion, clientPlatform,
    );
    const streamDetails = {
      ...queryDetails,
      statusCode: 200,
      sessionId: params.sessionId,
      runId: params.runId,
      afterCursor: params.afterCursor ?? null,
      clientRequestId: params.clientRequestId ?? null,
      resumeAttemptId: params.resumeAttemptId ?? null,
    };
    addBackendBreadcrumb({ action: "chat_live_attach_start", scope: streamScope, details: streamDetails });

    const stream = new PassThrough();
    openLiveStreams.add(stream);
    stream.once("close", () => openLiveStreams.delete(stream));
    const traceCarrier = params.traceContext?.sentryTrace != null || params.traceContext?.baggage != null
      ? params.traceContext ?? null
      : null;
    // The response is returned now and the stream fed until the run ends, the connection limit is reached
    // or the client disconnects, which destroys `stream`.
    void continueBackendTrace(traceCarrier, async () => startBackendSpan(
      "chat.live.stream",
      "http.server.sse",
      async () => runLiveStream(stream, { ...params, requestId }),
    )).catch((error: unknown) => {
      captureBackendException({
        action: "chat_live_stream_crashed",
        error: normalizeCaughtError(error),
        scope: streamScope,
        details: { ...streamDetails, statusCode: 500 },
      });
      if (!stream.destroyed && !stream.writableEnded) {
        stream.end();
      }
    });

    return context.body(Readable.toWeb(stream) as ReadableStream<Uint8Array>, 200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      // A buffering proxy would hold the stream back and deliver the whole answer at the end.
      "X-Accel-Buffering": "no",
    });
  });

  return app;
}
