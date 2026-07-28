import { randomUUID } from "node:crypto";
import type { Context } from "aws-lambda";
import type { APIGatewayProxyResult, LambdaEvent } from "hono/aws-lambda";
import {
  createDirectImageIngestionRequestTiming,
  runWithDirectImageIngestionRequestContext,
  type DirectImageIngestionRequestTiming,
} from "../server/directImageIngestionRequestTiming";
import { createCredentialedBrowserCorsResponseHeaders } from "../server/browserCors";
import {
  createAgentApiKeyErrorEnvelope,
  isAgentApiKeyAuthorizationHeader,
} from "../agent/envelope";

const directImageIngestionPathPattern =
  /^\/(?:v1\/)?workspaces\/[^/]+\/media-assets\/images\/?$/u;

type JsonRecord = Readonly<Record<string, unknown>>;

type ParsedDirectImageIngestionEvent = Readonly<{
  event: LambdaEvent;
  requestId: string;
  ingressAtMs: number;
}>;

export type DirectImageIngestionLambdaDependencies = Readonly<{
  allowedOriginsFn: () => ReadonlyArray<string>;
  handleRequestFn: (
    event: LambdaEvent,
    context: Context,
  ) => Promise<APIGatewayProxyResult>;
  nowFn: () => number;
}>;

function toRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null
    ? value as JsonRecord
    : null;
}

function isHeaderRecord(value: unknown): boolean {
  const record = toRecord(value);
  return record !== null
    && Object.values(record).every(
      (headerValue) => typeof headerValue === "string" || headerValue === undefined,
    );
}

function isRequestBody(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function getHeader(event: unknown, headerName: string): string | null {
  const eventRecord = toRecord(event);
  const headers = toRecord(eventRecord?.headers);
  if (headers === null) return null;

  const normalizedHeaderName = headerName.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === normalizedHeaderName && typeof value === "string") {
      return value;
    }
  }
  return null;
}

function getRequestId(event: unknown, context: Context): string {
  const eventRecord = toRecord(event);
  const requestContext = toRecord(eventRecord?.requestContext);
  const requestId = requestContext?.requestId;
  if (typeof requestId === "string" && requestId !== "") {
    return requestId;
  }
  return context.awsRequestId ?? randomUUID();
}

function parseIngressAtMs(ingressAtMs: unknown): number | null {
  if (!Number.isSafeInteger(ingressAtMs) || (ingressAtMs as number) < 1) {
    return null;
  }
  return ingressAtMs as number;
}

function parseVersionTwoEvent(event: JsonRecord): number | null {
  const rawPath = event.rawPath;
  if (
    event.version !== "2.0"
    || typeof rawPath !== "string"
    || !directImageIngestionPathPattern.test(rawPath)
    || typeof event.rawQueryString !== "string"
    || !isHeaderRecord(event.headers)
    || !isRequestBody(event.body)
    || typeof event.isBase64Encoded !== "boolean"
  ) {
    return null;
  }

  const requestContext = toRecord(event.requestContext);
  const http = toRecord(requestContext?.http);
  if (
    requestContext === null
    || http === null
    || typeof requestContext.requestId !== "string"
    || requestContext.requestId === ""
    || http.method !== "POST"
    || typeof http.path !== "string"
    || http.path !== rawPath
  ) {
    return null;
  }

  return parseIngressAtMs(requestContext.timeEpoch);
}

function parseVersionOneEvent(event: JsonRecord): number | null {
  const path = event.path;
  if (
    typeof path !== "string"
    || !directImageIngestionPathPattern.test(path)
    || event.httpMethod !== "POST"
    || !isHeaderRecord(event.headers)
    || !isRequestBody(event.body)
    || typeof event.isBase64Encoded !== "boolean"
  ) {
    return null;
  }

  const requestContext = toRecord(event.requestContext);
  if (
    requestContext === null
    || typeof requestContext.requestId !== "string"
    || requestContext.requestId === ""
  ) {
    return null;
  }

  return parseIngressAtMs(requestContext.requestTimeEpoch);
}

export function parseDirectImageIngestionLambdaEvent(
  event: unknown,
  context: Context,
): ParsedDirectImageIngestionEvent | null {
  const eventRecord = toRecord(event);
  if (eventRecord === null) return null;

  const ingressAtMs = "rawPath" in eventRecord
    ? parseVersionTwoEvent(eventRecord)
    : parseVersionOneEvent(eventRecord);
  if (ingressAtMs === null) return null;

  return {
    event: event as LambdaEvent,
    requestId: getRequestId(event, context),
    ingressAtMs,
  };
}

export function createDirectImageIngestionDeadlineResult(
  event: unknown,
  requestId: string,
  allowedOrigins: ReadonlyArray<string>,
): APIGatewayProxyResult {
  const statusCode = 503;
  const code = "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED";
  const message =
    "Media image ingestion cannot safely finish within its request deadline. phase=request";
  const authorizationHeader = getHeader(event, "authorization");
  const body = isAgentApiKeyAuthorizationHeader(authorizationHeader)
    ? createAgentApiKeyErrorEnvelope(
      requirePublicApiBaseUrl(),
      code,
      message,
      statusCode,
      requestId,
      undefined,
    )
    : {
      error: message,
      requestId,
      code,
    };
  return {
    statusCode,
    isBase64Encoded: false,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "retry-after": "1",
      "x-request-id": requestId,
      ...createCredentialedBrowserCorsResponseHeaders(
        getHeader(event, "origin"),
        allowedOrigins,
      ),
    },
    body: JSON.stringify(body),
  };
}

function requirePublicApiBaseUrl(): string {
  const publicApiBaseUrl = process.env.PUBLIC_API_BASE_URL?.trim();
  if (publicApiBaseUrl === undefined || publicApiBaseUrl === "") {
    throw new Error(
      "PUBLIC_API_BASE_URL is required for dedicated direct image ingestion API-key error envelopes.",
    );
  }
  return publicApiBaseUrl;
}

export function reportDirectImageIngestionHandled5xx(
  requestId: string,
  statusCode: number,
): void {
  if (statusCode < 500 || statusCode >= 600) {
    return;
  }
  console.error({
    domain: "backend",
    action: "direct_image_ingestion_handled_http_5xx",
    requestId,
    statusCode,
  });
}

export function createDirectImageIngestionLambdaHandler(
  dependencies: DirectImageIngestionLambdaDependencies,
): (
  event: LambdaEvent,
  context: Context,
) => Promise<APIGatewayProxyResult> {
  return async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    const allowedOrigins = dependencies.allowedOriginsFn();
    const parsed = parseDirectImageIngestionLambdaEvent(event, context);
    const nowMs = dependencies.nowFn();
    let timing: DirectImageIngestionRequestTiming | null = null;
    if (parsed !== null) {
      try {
        timing = createDirectImageIngestionRequestTiming(
          parsed.ingressAtMs,
          nowMs,
          () => context.getRemainingTimeInMillis(),
        );
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
    }
    if (
      parsed === null
      || timing === null
      || nowMs >= timing.preprocessingDeadlineAtMs
      || nowMs >= timing.integrationDeadlineAtMs
    ) {
      const requestId = getRequestId(event, context);
      const result = createDirectImageIngestionDeadlineResult(
        event,
        requestId,
        allowedOrigins,
      );
      reportDirectImageIngestionHandled5xx(
        requestId,
        result.statusCode,
      );
      return result;
    }

    const result = await runWithDirectImageIngestionRequestContext(
      parsed.requestId,
      timing,
      () => dependencies.handleRequestFn(parsed.event, context),
    );
    reportDirectImageIngestionHandled5xx(parsed.requestId, result.statusCode);
    return result;
  };
}
