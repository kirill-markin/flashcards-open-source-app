import type { Context } from "aws-lambda";
import type { APIGatewayProxyResult, LambdaEvent } from "hono/aws-lambda";
import {
  captureBackendException,
  createBackendObservationScope,
  initializeBackendSentry,
  normalizeCaughtError,
  wrapBackendHandler,
} from "../observability/sentry";

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
  );
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
