/**
 * Lambda Function URL entry point for the SSE live chat stream.
 * Uses awslambda.streamifyResponse to hold an open connection and stream
 * SSE events to the client.
 */
import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { APIGatewayProxyEventV2, StreamifyHandler } from "aws-lambda";
import { readOptionalChatRequestIdHeader, type LiveStreamParams } from "./chat/live/request";
import {
  addBackendBreadcrumb,
  captureBackendException,
  type BackendObservationScope,
  type ChatLiveBootstrapFailureDetails,
  continueBackendTrace,
  createBackendObservationScope,
  flushBackendSentry,
  type BackendTraceCarrier,
  initializeBackendSentry,
  normalizeCaughtError,
  startBackendSpan,
  wrapBackendStreamHandler,
} from "./observability/sentry";

initializeBackendSentry("chat-live");

declare const awslambda: {
  streamifyResponse: (
    handler: StreamifyHandler<APIGatewayProxyEventV2, void>,
  ) => StreamifyHandler<APIGatewayProxyEventV2, void>;
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

function hasLiveTraceCarrierValue(traceCarrier: BackendTraceCarrier | null | undefined): traceCarrier is BackendTraceCarrier {
  return traceCarrier !== null
    && traceCarrier !== undefined
    && (traceCarrier.sentryTrace !== null || traceCarrier.baggage !== null);
}

function isPresentHeaderValue(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function compareHeaderNames(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function readApiGatewayHeader(headers: APIGatewayProxyEventV2["headers"] | undefined, name: string): string | null {
  if (headers === undefined) {
    return null;
  }

  const exactValue = headers[name];
  if (isPresentHeaderValue(exactValue)) {
    return exactValue;
  }

  const normalizedName = name.toLowerCase();
  const matchingNames = Object.keys(headers)
    .filter((headerName) => headerName.toLowerCase() === normalizedName)
    .sort(compareHeaderNames);

  for (const headerName of matchingNames) {
    const value = headers[headerName];
    if (isPresentHeaderValue(value)) {
      return value;
    }
  }

  return null;
}

function getRequestTraceCarrier(headers: APIGatewayProxyEventV2["headers"] | undefined): BackendTraceCarrier | null {
  const sentryTrace = readApiGatewayHeader(headers, "sentry-trace");
  const baggage = readApiGatewayHeader(headers, "baggage");
  if (sentryTrace === null && baggage === null) {
    return null;
  }

  return {
    sentryTrace,
    baggage,
  };
}

function resolveLiveTraceCarrier(
  tokenTraceCarrier: BackendTraceCarrier | null | undefined,
  headers: APIGatewayProxyEventV2["headers"] | undefined,
): BackendTraceCarrier | null {
  if (hasLiveTraceCarrierValue(tokenTraceCarrier)) {
    return tokenTraceCarrier;
  }

  return getRequestTraceCarrier(headers);
}

type LiveRequestSafeQueryDetails = Readonly<{
  sessionId: string | null;
  runId: string | null;
  afterCursor: string | null;
  hasToken: boolean;
  hasWorkspaceId: boolean;
}>;

type ChatLiveRuntime = Readonly<{
  runLiveStream: typeof import("./chat/live/index").runLiveStream;
  createChatLiveErrorResponse: typeof import("./chat/live/errors").createChatLiveErrorResponse;
  handleLiveRequest: typeof import("./chat/live/request").handleLiveRequest;
  flushLangfuseTelemetry: typeof import("./telemetry/langfuse").flushLangfuseTelemetry;
}>;

type FlushLangfuseTelemetry = ChatLiveRuntime["flushLangfuseTelemetry"];

type ChatLiveBootstrapErrorBody = Readonly<{
  error: string;
  requestId: string;
  code: "INTERNAL_ERROR";
}>;

let chatLiveRuntimePromise: Promise<ChatLiveRuntime> | null = null;

async function createChatLiveRuntime(): Promise<ChatLiveRuntime> {
  const [
    { flushLangfuseTelemetry, initializeLangfuseTelemetry },
    { runLiveStream },
    { createChatLiveErrorResponse },
    { handleLiveRequest },
  ] = await Promise.all([
    import("./telemetry/langfuse"),
    import("./chat/live/index"),
    import("./chat/live/errors"),
    import("./chat/live/request"),
  ]);
  initializeLangfuseTelemetry();
  return {
    runLiveStream,
    createChatLiveErrorResponse,
    handleLiveRequest,
    flushLangfuseTelemetry,
  };
}

function getChatLiveRuntime(): Promise<ChatLiveRuntime> {
  if (chatLiveRuntimePromise === null) {
    chatLiveRuntimePromise = createChatLiveRuntime();
  }

  return chatLiveRuntimePromise;
}

async function flushLiveTelemetry(
  flushLangfuseTelemetry: FlushLangfuseTelemetry,
  observationScope: BackendObservationScope,
): Promise<void> {
  await flushLangfuseTelemetry(observationScope);
  await flushBackendSentry(2000);
}

function createLiveRequestUrl(event: APIGatewayProxyEventV2): URL {
  const querySuffix = event.rawQueryString === "" ? "" : `?${event.rawQueryString}`;
  return new URL(`${event.rawPath}${querySuffix}`, "http://localhost");
}

function getLiveRequestSafeQueryDetails(url: URL): LiveRequestSafeQueryDetails {
  return {
    sessionId: url.searchParams.get("sessionId"),
    runId: url.searchParams.get("runId"),
    afterCursor: url.searchParams.get("afterCursor"),
    hasToken: url.searchParams.has("token"),
    hasWorkspaceId: url.searchParams.has("workspaceId"),
  };
}

function createChatLiveBootstrapFailureDetails(
  event: APIGatewayProxyEventV2,
  error: Error,
): ChatLiveBootstrapFailureDetails {
  const url = createLiveRequestUrl(event);
  const safeQueryDetails = getLiveRequestSafeQueryDetails(url);
  const authorizationHeader = readApiGatewayHeader(event.headers, "authorization") ?? undefined;
  const clientRequestId = readOptionalChatRequestIdHeader(event.headers ?? {}) ?? null;

  return {
    statusCode: 500,
    path: event.rawPath,
    ...safeQueryDetails,
    origin: readApiGatewayHeader(event.headers, "origin"),
    authScheme: getLiveAuthorizationScheme(authorizationHeader),
    clientRequestId,
    resumeAttemptId: readApiGatewayHeader(event.headers, "x-chat-resume-attempt-id"),
    clientPlatform: readApiGatewayHeader(event.headers, "x-client-platform"),
    clientVersion: readApiGatewayHeader(event.headers, "x-client-version"),
    code: "INTERNAL_ERROR",
    message: error.message,
  };
}

function createChatLiveBootstrapErrorBody(requestId: string): ChatLiveBootstrapErrorBody {
  return {
    error: "Request failed. Try again.",
    requestId,
    code: "INTERNAL_ERROR",
  };
}

function writeChatLiveBootstrapErrorResponse(responseStream: Writable, requestId: string): void {
  if (responseStream.destroyed || responseStream.writableEnded) {
    return;
  }

  const metadata = {
    statusCode: 500,
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
  };
  const stream = awslambda.HttpResponseStream.from(responseStream, metadata);
  stream.write(JSON.stringify(createChatLiveBootstrapErrorBody(requestId)));
  stream.end();
}

async function liveStreamHandler(
  event: APIGatewayProxyEventV2,
  responseStream: Writable,
  runtime: ChatLiveRuntime,
): Promise<void> {
  const {
    runLiveStream,
    createChatLiveErrorResponse,
    handleLiveRequest,
    flushLangfuseTelemetry,
  } = runtime;
  const requestId = getLiveRequestId(event);
  const url = createLiveRequestUrl(event);
  const safeQueryDetails = getLiveRequestSafeQueryDetails(url);
  const authorizationHeader = readApiGatewayHeader(event.headers, "authorization") ?? undefined;
  const origin = readApiGatewayHeader(event.headers, "origin");
  const clientRequestId = readOptionalChatRequestIdHeader(event.headers ?? {}) ?? null;
  const resumeAttemptId = readApiGatewayHeader(event.headers, "x-chat-resume-attempt-id");
  const clientPlatform = readApiGatewayHeader(event.headers, "x-client-platform");
  const clientVersion = readApiGatewayHeader(event.headers, "x-client-version");
  const method = event.requestContext.http.method;
  const requestObservationScope = createBackendObservationScope(
    "chat-live",
    requestId,
    event.rawPath,
    method,
    null,
    null,
    clientRequestId,
    url.searchParams.get("runId"),
    url.searchParams.get("sessionId"),
  );

  let params: LiveStreamParams;

  try {
    params = await handleLiveRequest(url, authorizationHeader, event.headers ?? {});
  } catch (error) {
    const errorResponse = createChatLiveErrorResponse(error, requestId);
    const details = {
      statusCode: errorResponse.statusCode,
      path: event.rawPath,
      ...safeQueryDetails,
      origin,
      authScheme: getLiveAuthorizationScheme(authorizationHeader),
      clientRequestId,
      resumeAttemptId,
      clientPlatform,
      clientVersion,
      code: errorResponse.body.code,
      message: error instanceof Error ? error.message : String(error),
    };
    if (errorResponse.statusCode >= 500) {
      captureBackendException({
        action: "chat_live_request_error",
        error: normalizeCaughtError(error),
        scope: requestObservationScope,
        details,
      });
    } else {
      addBackendBreadcrumb({
        action: "chat_live_request_error",
        scope: requestObservationScope,
        details,
      });
    }
    const metadata = {
      statusCode: errorResponse.statusCode,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    };
    const stream = awslambda.HttpResponseStream.from(responseStream, metadata);
    stream.write(JSON.stringify(errorResponse.body));
    stream.end();
    await flushLiveTelemetry(flushLangfuseTelemetry, requestObservationScope);
    return;
  }

  const streamObservationScope = createBackendObservationScope(
    "chat-live",
    requestId,
    event.rawPath,
    method,
    params.userId,
    params.workspaceId,
    params.clientRequestId ?? null,
    params.runId,
    params.sessionId,
  );

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

  addBackendBreadcrumb({
    action: "chat_live_attach_start",
    scope: streamObservationScope,
    details: {
      statusCode: 200,
      path: event.rawPath,
      sessionId: params.sessionId,
      runId: params.runId,
      afterCursor: params.afterCursor ?? null,
      hasToken: safeQueryDetails.hasToken,
      hasWorkspaceId: safeQueryDetails.hasWorkspaceId,
      origin,
      authScheme: getLiveAuthorizationScheme(authorizationHeader),
      clientRequestId: params.clientRequestId ?? null,
      resumeAttemptId: params.resumeAttemptId ?? null,
      clientPlatform: params.clientPlatform ?? null,
      clientVersion: params.clientVersion ?? null,
    },
  });

  try {
    const traceCarrier = resolveLiveTraceCarrier(params.traceContext ?? null, event.headers);
    await continueBackendTrace(traceCarrier, async () => startBackendSpan(
      "chat.live.stream",
      "http.server.sse",
      async () => runLiveStream(stream, {
        ...params,
        requestId,
      }),
    ));
    await flushLiveTelemetry(flushLangfuseTelemetry, streamObservationScope);
  } catch (error) {
    captureBackendException({
      action: "chat_live_stream_crashed",
      error: normalizeCaughtError(error),
      scope: streamObservationScope,
      details: {
        statusCode: 500,
        path: event.rawPath,
        sessionId: params.sessionId,
        runId: params.runId,
        afterCursor: params.afterCursor ?? null,
        hasToken: safeQueryDetails.hasToken,
        hasWorkspaceId: safeQueryDetails.hasWorkspaceId,
        origin,
        authScheme: getLiveAuthorizationScheme(authorizationHeader),
        clientRequestId: params.clientRequestId ?? null,
        resumeAttemptId: params.resumeAttemptId ?? null,
        clientPlatform: params.clientPlatform ?? null,
        clientVersion: params.clientVersion ?? null,
      },
    });
    await flushLiveTelemetry(flushLangfuseTelemetry, streamObservationScope);
    if (stream.destroyed === false && stream.writableEnded === false) {
      stream.end();
    }
  }
}

const chatLiveStreamHandler: StreamifyHandler<APIGatewayProxyEventV2, void> = async (
  event: APIGatewayProxyEventV2,
  responseStream: awslambda.HttpResponseStream,
): Promise<void> => {
  let flushLangfuseTelemetry: ((observationScope: BackendObservationScope) => Promise<void>) | null = null;
  try {
    const runtime = await getChatLiveRuntime();
    flushLangfuseTelemetry = runtime.flushLangfuseTelemetry;
    await liveStreamHandler(event, responseStream, runtime);
  } catch (error) {
    const normalizedError = normalizeCaughtError(error);
    const requestId = getLiveRequestId(event);
    const clientRequestId = readOptionalChatRequestIdHeader(event.headers ?? {}) ?? null;
    const observationScope = createBackendObservationScope(
      "chat-live",
      requestId,
      event.rawPath,
      event.requestContext.http.method,
      null,
      null,
      clientRequestId,
      null,
      null,
    );
    captureBackendException({
      action: "chat_live_bootstrap_failed",
      error: normalizedError,
      scope: observationScope,
      details: createChatLiveBootstrapFailureDetails(event, normalizedError),
    });
    try {
      writeChatLiveBootstrapErrorResponse(responseStream, requestId);
    } finally {
      if (flushLangfuseTelemetry === null) {
        await flushBackendSentry(2000);
      } else {
        await flushLiveTelemetry(flushLangfuseTelemetry, observationScope);
      }
    }
  }
};

export const handler = wrapBackendStreamHandler(awslambda.streamifyResponse(chatLiveStreamHandler));
