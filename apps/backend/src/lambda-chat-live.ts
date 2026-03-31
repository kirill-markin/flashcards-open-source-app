/**
 * Lambda Function URL entry point for the SSE live chat stream.
 * Uses awslambda.streamifyResponse to hold an open connection and stream
 * SSE events to the client.
 */
import type { Writable } from "node:stream";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handleLiveRequest, runLiveStream } from "./chat/live";
import { initializeLangfuseTelemetry } from "./telemetry/langfuse";

initializeLangfuseTelemetry();

declare const awslambda: {
  streamifyResponse: (handler: (event: APIGatewayProxyEventV2, responseStream: Writable) => Promise<void>) => unknown;
  HttpResponseStream: {
    from: (stream: Writable, metadata: Record<string, unknown>) => Writable;
  };
};

const ALLOWED_ORIGINS = (process.env.BACKEND_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);

function getCorsHeaders(origin: string | undefined): Record<string, string> {
  const effectiveOrigin = origin !== undefined && ALLOWED_ORIGINS.includes(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": effectiveOrigin,
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

export const handler = awslambda.streamifyResponse(
  async (event: APIGatewayProxyEventV2, responseStream: Writable) => {
    const origin = event.headers?.origin;
    const corsHeaders = getCorsHeaders(origin);

    if (event.requestContext?.http?.method === "OPTIONS") {
      const metadata = {
        statusCode: 204,
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      };
      const stream = awslambda.HttpResponseStream.from(responseStream, metadata);
      stream.end();
      return;
    }

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
          ...corsHeaders,
        },
      };
      const stream = awslambda.HttpResponseStream.from(responseStream, metadata);
      await runLiveStream(stream, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const metadata = {
        statusCode: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      };
      const stream = awslambda.HttpResponseStream.from(responseStream, metadata);
      stream.write(JSON.stringify({ error: message }));
      stream.end();
    }
  },
);
