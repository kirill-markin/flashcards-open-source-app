import type { Context } from "aws-lambda";
import type { APIGatewayProxyResult, LambdaEvent } from "hono/aws-lambda";
import {
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../observability/sentry";
import {
  createAgentApiKeyErrorEnvelope,
  isAgentApiKeyAuthorizationHeader,
} from "../agent/envelope";
import {
  createCredentialedBrowserCorsResponseHeaders,
  getAllowedBrowserOrigins,
} from "../server/browserCors";
import {
  isDirectImageIngestionPostTarget,
  isMultipartCompletionPostTarget,
  readApiGatewayRequestTarget,
} from "../server/mediaRequests/directImageIngestionRouting";
import {
  createMultipartCompletionRequestTiming,
  readMultipartCompletionIngressAtMs,
  runWithMultipartCompletionRequestTiming,
  type MultipartCompletionRequestTiming,
} from "../server/mediaRequests/multipartCompletionRequestTiming";

initializeBackendSentry("backend-api");

type BackendApiHandler = (
  event: LambdaEvent,
  context: Context,
) => Promise<APIGatewayProxyResult>;

type BackendApiRuntime = Readonly<{
  handleRequest: BackendApiHandler;
  flushLangfuseTelemetry: typeof import("../telemetry/langfuse").flushLangfuseTelemetry;
}>;

type BackendApiRequestContext = Readonly<{
  requestId: string | null;
  route: string | null;
  method: string | null;
}>;

let backendApiRuntimePromise: Promise<BackendApiRuntime> | null = null;

async function createBackendApiRuntime(): Promise<BackendApiRuntime> {
  const [
    { flushLangfuseTelemetry, initializeLangfuseTelemetry },
    { handle },
    { createApp },
  ] = await Promise.all([
    import("../telemetry/langfuse"),
    import("hono/aws-lambda"),
    import("../server/app"),
  ]);
  initializeLangfuseTelemetry();
  const app = createApp("");
  return {
    handleRequest: handle(app),
    flushLangfuseTelemetry,
  };
}

function getBackendApiRuntime(): Promise<BackendApiRuntime> {
  if (backendApiRuntimePromise === null) {
    backendApiRuntimePromise = createBackendApiRuntime();
  }

  return backendApiRuntimePromise;
}

function getBackendApiRequestContext(event: LambdaEvent, context: Context): BackendApiRequestContext {
  const lambdaRequestId = context.awsRequestId ?? null;
  if ("rawPath" in event) {
    return {
      requestId: event.requestContext.requestId ?? lambdaRequestId,
      route: event.rawPath,
      method: event.requestContext.http.method,
    };
  }

  if ("httpMethod" in event) {
    const requestId = "requestId" in event.requestContext
      ? event.requestContext.requestId
      : lambdaRequestId;
    return {
      requestId,
      route: event.path,
      method: event.httpMethod,
    };
  }

  return {
    requestId: lambdaRequestId,
    route: event.path,
    method: event.method,
  };
}

function requirePublicApiBaseUrl(): string {
  const publicApiBaseUrl = process.env.PUBLIC_API_BASE_URL?.trim();
  if (publicApiBaseUrl === undefined || publicApiBaseUrl === "") {
    throw new Error(
      "PUBLIC_API_BASE_URL is required for shared direct image ingestion guard API-key error envelopes.",
    );
  }
  return publicApiBaseUrl;
}

const backendApiBootstrapHandler: BackendApiHandler = async (event, context) => {
  const requestContext = getBackendApiRequestContext(event, context);
  const observationScope = createBackendObservationScope(
    "backend-api",
    requestContext.requestId,
    requestContext.route,
    requestContext.method,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
  if (isDirectImageIngestionPostTarget(readApiGatewayRequestTarget(event))) {
    const requestId = requestContext.requestId ?? context.awsRequestId;
    const requestHeaders = Object.entries(event.headers ?? {});
    const readRequestHeader = (headerName: string): string | null =>
      requestHeaders.find(
        ([name, value]) =>
          name.toLowerCase() === headerName && typeof value === "string",
      )?.[1] ?? null;
    const code = "DIRECT_IMAGE_INGESTION_ROUTE_UNAVAILABLE";
    const message =
      "Direct image ingestion is available only through its bounded API route.";
    const body = isAgentApiKeyAuthorizationHeader(
      readRequestHeader("authorization"),
    )
      ? createAgentApiKeyErrorEnvelope(
        requirePublicApiBaseUrl(),
        code,
        message,
        404,
        requestId,
        undefined,
      )
      : {
        error: message,
        requestId,
        code,
      };
    return {
      statusCode: 404,
      isBase64Encoded: false,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-request-id": requestId,
        ...createCredentialedBrowserCorsResponseHeaders(
          readRequestHeader("origin"),
          getAllowedBrowserOrigins(),
        ),
      },
      body: JSON.stringify(body),
    };
  }
  const handleRequest = async (): Promise<APIGatewayProxyResult> => {
    let runtime: BackendApiRuntime | null = null;
    try {
      runtime = await getBackendApiRuntime();
      return await runtime.handleRequest(event, context);
    } catch (error) {
      if (runtime === null) {
        const normalizedError = normalizeCaughtError(error);
        captureBackendException({
          action: "request_failed",
          error: normalizedError,
          scope: observationScope,
          details: {
            statusCode: 500,
            code: "INTERNAL_ERROR",
            message: normalizedError.message,
            validationIssues: [],
          },
        });
      }
      throw error;
    } finally {
      if (runtime !== null) {
        await runtime.flushLangfuseTelemetry(observationScope);
      }
    }
  };

  const requestTarget = readApiGatewayRequestTarget(event);
  if (!isMultipartCompletionPostTarget(requestTarget)) {
    return handleRequest();
  }

  const ingressAtMs = readMultipartCompletionIngressAtMs(event);
  const timing: MultipartCompletionRequestTiming | null =
    ingressAtMs === null
      ? null
      : createMultipartCompletionRequestTiming(
        ingressAtMs,
        Date.now(),
        context.getRemainingTimeInMillis(),
      );
  return runWithMultipartCompletionRequestTiming(timing, handleRequest);
};

/**
 * Keeps the default buffered Lambda proxy behavior for the main backend
 * routes such as `/health`, `/me`, workspace-scoped sync JSON endpoints,
 * and the backend-owned chat control-plane endpoints.
 *
 * Those endpoints return complete JSON payloads, so streaming would add no
 * benefit and would make API Gateway treat every route as a streaming
 * integration.
 */
export const handler = wrapBackendHandler(backendApiBootstrapHandler);
