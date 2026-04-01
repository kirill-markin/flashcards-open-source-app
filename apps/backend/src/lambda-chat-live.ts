/**
 * Lambda Function URL entry point for the SSE live chat stream.
 * Uses awslambda.streamifyResponse to hold an open connection and stream
 * SSE events to the client.
 */
import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handleLiveRequest, runLiveStream } from "./chat/live";
import { getErrorLogContext, logCloudRouteEvent } from "./server/logging";
import { initializeLangfuseTelemetry } from "./telemetry/langfuse";

initializeLangfuseTelemetry();

declare const awslambda: {
  streamifyResponse: (handler: (event: APIGatewayProxyEventV2, responseStream: Writable) => Promise<void>) => unknown;
  HttpResponseStream: {
    from: (stream: Writable, metadata: Record<string, unknown>) => Writable;
  };
};

function getLiveRequestId(event: APIGatewayProxyEventV2): string {
  return event.requestContext.requestId ?? randomUUID();
}

function getLiveAuthorizationScheme(authorizationHeader: string | undefined): string {
  if (authorizationHeader === undefined || authorizationHeader === "") {
    return "missing";
  }

  if (authorizationHeader.startsWith("Bearer ")) {
    return "bearer";
  }

  if (authorizationHeader.startsWith("Live ")) {
    return "live";
  }

  if (authorizationHeader.startsWith("Guest ")) {
    return "guest";
  }

  if (authorizationHeader.startsWith("ApiKey ")) {
    return "api_key";
  }

  return "unknown";
}

export const handler = awslambda.streamifyResponse(
  async (event: APIGatewayProxyEventV2, responseStream: Writable) => {
    const requestId = getLiveRequestId(event);

    const url = new URL(event.rawPath + "?" + (event.rawQueryString ?? ""), "http://localhost");
    const authorizationHeader = event.headers?.authorization;

    try {
      const params = await handleLiveRequest(url, authorizationHeader);

      const metadata = {
        statusCode: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-store",
          "Connection": "keep-alive",
          "X-Request-Id": requestId,
        },
      };
      const stream = awslambda.HttpResponseStream.from(responseStream, metadata);
      await runLiveStream(stream, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logCloudRouteEvent("chat_live_request_error", {
        requestId,
        path: event.rawPath,
        method: event.requestContext.http.method,
        rawQueryString: event.rawQueryString,
        sessionId: url.searchParams.get("sessionId"),
        afterCursor: url.searchParams.get("afterCursor"),
        origin: event.headers?.origin ?? null,
        authScheme: getLiveAuthorizationScheme(authorizationHeader),
        statusCode: 400,
        ...getErrorLogContext(error),
      }, true);
      const metadata = {
        statusCode: 400,
        headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      };
      const stream = awslambda.HttpResponseStream.from(responseStream, metadata);
      stream.write(JSON.stringify({ error: message, requestId }));
      stream.end();
    }
  },
);
