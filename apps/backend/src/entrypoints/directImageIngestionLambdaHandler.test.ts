import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "aws-lambda";
import type { APIGatewayProxyResult, LambdaEvent } from "hono/aws-lambda";
import { handle } from "hono/aws-lambda";
import {
  createDirectImageIngestionLambdaHandler,
  parseDirectImageIngestionLambdaEvent,
} from "./directImageIngestionLambdaHandler";
import { resetAuthConfigForTests } from "../auth/config";
import {
  configureBackendRuntimeObservability,
  resetBackendRuntimeObservability,
} from "../observability/runtime";
import type {
  BackendExceptionEvent,
} from "../observability/sentry/events";
import { createDirectImageIngestionApp } from "../server/mediaRequests/directImageIngestionApp";
import {
  directImageIngestionGatewayServiceHeadroomMs,
  directImageIngestionIntegrationEnvelopeMs,
  directImageIngestionLambdaInvokeTimeoutMs,
  directImageIngestionMaximumOnDemandInitMs,
  directImageIngestionRequestBudgetMs,
  directImageIngestionResponseMarginMs,
  publicRestApiIntegrationTimeoutMs,
  getDirectImageIngestionRequestTiming,
} from "../server/mediaRequests/directImageIngestionRequestTiming";

const directImagePath =
  "/workspaces/11111111-1111-4111-8111-111111111111/media-assets/images";
const catalogCollectionCoverPath =
  "/admin/catalog/collections/22222222-2222-4222-8222-222222222222/cover";
const allowedOrigin = "https://app.flashcards-open-source-app.com";

function createLambdaContext(remainingTimeMs: number): Context {
  return {
    awsRequestId: "lambda-request-1",
    callbackWaitsForEmptyEventLoop: true,
    getRemainingTimeInMillis: () => remainingTimeMs,
  } as Context;
}

function createRestApiEvent(
  ingressAtMs: number,
  origin: string | null,
): LambdaEvent {
  return {
    httpMethod: "POST",
    path: directImagePath,
    headers: origin === null ? {} : { origin },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: {
      workspaceId: "11111111-1111-4111-8111-111111111111",
    },
    stageVariables: null,
    requestContext: {
      requestId: "api-gateway-request-1",
      requestTimeEpoch: ingressAtMs,
    },
    resource: "/workspaces/{workspaceId}/media-assets/images",
    body: null,
    isBase64Encoded: false,
  } as unknown as LambdaEvent;
}

function createHttpApiEvent(
  ingressAtMs: number,
  http: Readonly<Record<string, unknown>> | null,
): LambdaEvent {
  return {
    version: "2.0",
    routeKey: "POST /workspaces/{workspaceId}/media-assets/images",
    rawPath: directImagePath,
    rawQueryString: "",
    headers: {},
    requestContext: {
      requestId: "api-gateway-v2-request-1",
      timeEpoch: ingressAtMs,
      ...(http === null ? {} : { http }),
    },
    body: null,
    isBase64Encoded: false,
  } as unknown as LambdaEvent;
}

function createSuccessResult(): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {},
    body: "{}",
    isBase64Encoded: false,
  };
}

test("hard direct-ingestion timing leaves service and response margins", () => {
  assert.equal(directImageIngestionMaximumOnDemandInitMs, 10_000);
  assert.equal(directImageIngestionLambdaInvokeTimeoutMs, 15_000);
  assert.equal(
    directImageIngestionIntegrationEnvelopeMs,
    directImageIngestionMaximumOnDemandInitMs
      + directImageIngestionLambdaInvokeTimeoutMs,
  );
  assert.ok(
    directImageIngestionIntegrationEnvelopeMs
      < publicRestApiIntegrationTimeoutMs,
  );
  assert.equal(directImageIngestionGatewayServiceHeadroomMs, 4_000);
  assert.equal(
    directImageIngestionRequestBudgetMs
      + directImageIngestionResponseMarginMs,
    directImageIngestionLambdaInvokeTimeoutMs,
  );
});

test("valid REST event carries its server-authored ingress timing", async () => {
  const ingressAtMs = 1_000_000;
  const context = createLambdaContext(
    directImageIngestionLambdaInvokeTimeoutMs,
  );
  let handleCalls = 0;
  const handler = createDirectImageIngestionLambdaHandler({
    allowedOriginsFn: () => [allowedOrigin],
    handleRequestFn: async () => {
      handleCalls += 1;
      return createSuccessResult();
    },
    nowFn: () => ingressAtMs + 1,
  });

  const result = await handler(
    createRestApiEvent(ingressAtMs, null),
    context,
  );

  assert.equal(result.statusCode, 200);
  assert.equal(handleCalls, 1);
  assert.equal(context.callbackWaitsForEmptyEventLoop, false);
});

test("valid collection cover PUT reaches the dedicated Lambda boundary", () => {
  const ingressAtMs = 1_000_000;
  const event = {
    ...createRestApiEvent(ingressAtMs, null) as unknown as Record<string, unknown>,
    httpMethod: "PUT",
    path: catalogCollectionCoverPath,
    pathParameters: {
      collectionId: "22222222-2222-4222-8222-222222222222",
    },
    resource: "/admin/catalog/collections/{collectionId}/cover",
  } as unknown as LambdaEvent;

  assert.notEqual(
    parseDirectImageIngestionLambdaEvent(
      event,
      createLambdaContext(directImageIngestionLambdaInvokeTimeoutMs),
    ),
    null,
  );
});

test("Lambda remaining time clamps the application deadline", async () => {
  const ingressAtMs = 1_000_000;
  const observedAtMs = ingressAtMs + 1;
  let observedRequestDeadlineAtMs: number | null = null;
  const handler = createDirectImageIngestionLambdaHandler({
    allowedOriginsFn: () => [allowedOrigin],
    handleRequestFn: async () => {
      observedRequestDeadlineAtMs =
        getDirectImageIngestionRequestTiming()?.requestDeadlineAtMs ?? null;
      return createSuccessResult();
    },
    nowFn: () => observedAtMs,
  });

  const result = await handler(
    createRestApiEvent(ingressAtMs, null),
    createLambdaContext(14_000),
  );

  assert.equal(result.statusCode, 200);
  assert.equal(
    observedRequestDeadlineAtMs,
    observedAtMs + 14_000 - directImageIngestionResponseMarginMs,
  );
});

test("cold-start age rejects before route work at the pre-acquisition cutoff", async () => {
  const ingressAtMs = 1_000_000;
  let handleCalls = 0;
  const handler = createDirectImageIngestionLambdaHandler({
    allowedOriginsFn: () => [allowedOrigin],
    handleRequestFn: async () => {
      handleCalls += 1;
      return createSuccessResult();
    },
    nowFn: () =>
      ingressAtMs
      + directImageIngestionRequestBudgetMs
      - 10_000,
  });

  const result = await handler(
    createRestApiEvent(ingressAtMs, allowedOrigin),
    createLambdaContext(directImageIngestionLambdaInvokeTimeoutMs),
  );

  assert.equal(result.statusCode, 503);
  assert.equal(handleCalls, 0);
  assert.equal(result.headers?.["retry-after"], "1");
});

test("old ingress rejects before route work with credentialed CORS", async () => {
  const ingressAtMs = 1_000_000;
  let handleCalls = 0;
  const handler = createDirectImageIngestionLambdaHandler({
    allowedOriginsFn: () => [allowedOrigin],
    handleRequestFn: async () => {
      handleCalls += 1;
      return createSuccessResult();
    },
    nowFn: () => ingressAtMs + directImageIngestionRequestBudgetMs,
  });

  const result = await handler(
    createRestApiEvent(ingressAtMs, allowedOrigin),
    createLambdaContext(directImageIngestionLambdaInvokeTimeoutMs),
  );

  assert.equal(result.statusCode, 503);
  assert.equal(handleCalls, 0);
  assert.equal(result.headers?.["access-control-allow-origin"], allowedOrigin);
  assert.equal(result.headers?.["access-control-allow-credentials"], "true");
  assert.match(
    String(result.headers?.["access-control-expose-headers"]),
    /retry-after/u,
  );
});

test("outer API-key deadline failures preserve the published agent error envelope", async () => {
  const ingressAtMs = 1_000_000;
  const originalPublicApiBaseUrl = process.env.PUBLIC_API_BASE_URL;
  process.env.PUBLIC_API_BASE_URL =
    "https://api.flashcards-open-source-app.com/v1";
  try {
    const baseEvent = createRestApiEvent(ingressAtMs, null) as unknown as {
      headers: Record<string, string>;
    };
    const event = {
      ...baseEvent,
      headers: {
        ...baseEvent.headers,
        authorization: "ApiKey invalid",
      },
    };
    const handler = createDirectImageIngestionLambdaHandler({
      allowedOriginsFn: () => [allowedOrigin],
      handleRequestFn: async () => createSuccessResult(),
      nowFn: () => ingressAtMs + directImageIngestionRequestBudgetMs,
    });

    const result = await handler(
      event as unknown as LambdaEvent,
      createLambdaContext(directImageIngestionLambdaInvokeTimeoutMs),
    );
    const body = JSON.parse(result.body);

    assert.equal(result.statusCode, 503);
    assert.equal(body.ok, false);
    assert.deepEqual(body.data, {});
    assert.equal(
      body.error.code,
      "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED",
    );
    assert.equal(
      body.instructions,
      "Retry the unchanged request after the Retry-After delay. If it fails again, stop and use requestId when debugging.",
    );
    assert.equal(
      body.docs.discoveryUrl,
      "https://api.flashcards-open-source-app.com/v1/",
    );
    assert.equal(
      body.docs.source.repositoryUrl,
      "https://github.com/kirill-markin/flashcards-open-source-app",
    );
    assert.equal(body.requestId, "api-gateway-request-1");
  } finally {
    if (originalPublicApiBaseUrl === undefined) {
      delete process.env.PUBLIC_API_BASE_URL;
    } else {
      process.env.PUBLIC_API_BASE_URL = originalPublicApiBaseUrl;
    }
  }
});

test("dedicated handler emits one structured marker for handled HTTP 5xx", async () => {
  const ingressAtMs = 1_000_000;
  const messages: Array<unknown> = [];
  const originalConsoleError = console.error;
  console.error = (message?: unknown): void => {
    messages.push(message);
  };
  try {
    const handler = createDirectImageIngestionLambdaHandler({
      allowedOriginsFn: () => [allowedOrigin],
      handleRequestFn: async () => ({
        statusCode: 503,
        headers: { "retry-after": "1" },
        body: "{}",
        isBase64Encoded: false,
      }),
      nowFn: () => ingressAtMs + 1,
    });

    await handler(
      createRestApiEvent(ingressAtMs, null),
      createLambdaContext(directImageIngestionLambdaInvokeTimeoutMs),
    );

    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], {
      domain: "backend",
      action: "direct_image_ingestion_handled_http_5xx",
      requestId: "api-gateway-request-1",
      statusCode: 503,
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("dedicated route correlates its response and failure logs with the Gateway request ID", async () => {
  const ingressAtMs = 1_000_000;
  const originalAuthMode = process.env.AUTH_MODE;
  const capturedExceptions: Array<BackendExceptionEvent> = [];
  const consoleErrors: Array<unknown> = [];
  const originalConsoleError = console.error;
  process.env.AUTH_MODE = "cognito";
  resetAuthConfigForTests();
  configureBackendRuntimeObservability("backend-api", {
    addBreadcrumb: () => {},
    captureWarning: () => {},
    captureException: (event) => capturedExceptions.push(event),
  });
  console.error = (message?: unknown): void => {
    consoleErrors.push(message);
  };

  try {
    const handler = createDirectImageIngestionLambdaHandler({
      allowedOriginsFn: () => [allowedOrigin],
      handleRequestFn: handle(createDirectImageIngestionApp()),
      nowFn: () => ingressAtMs + 1,
    });
    const event = {
      ...createRestApiEvent(ingressAtMs, null),
      headers: { "x-request-id": "client-forged-request-id" },
    } as LambdaEvent;

    const result = await handler(
      event,
      createLambdaContext(directImageIngestionLambdaInvokeTimeoutMs),
    );
    const body = JSON.parse(result.body) as Readonly<{
      requestId: string;
      code: string;
    }>;
    const responseRequestId = "headers" in result
      ? result.headers?.["x-request-id"]
      : result.multiValueHeaders["x-request-id"]?.[0];

    assert.equal(result.statusCode, 503);
    assert.equal(body.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
    assert.equal(responseRequestId, "api-gateway-request-1");
    assert.equal(body.requestId, "api-gateway-request-1");
    assert.equal(capturedExceptions.length, 1);
    assert.equal(
      capturedExceptions[0]?.scope.requestId,
      "api-gateway-request-1",
    );
    assert.deepEqual(consoleErrors, [{
      domain: "backend",
      action: "direct_image_ingestion_handled_http_5xx",
      requestId: "api-gateway-request-1",
      statusCode: 503,
    }]);
  } finally {
    console.error = originalConsoleError;
    resetBackendRuntimeObservability();
    if (originalAuthMode === undefined) {
      delete process.env.AUTH_MODE;
    } else {
      process.env.AUTH_MODE = originalAuthMode;
    }
    resetAuthConfigForTests();
  }
});

test("early response does not grant CORS to an unallowed or absent origin", async () => {
  const ingressAtMs = 1_000_000;
  const handler = createDirectImageIngestionLambdaHandler({
    allowedOriginsFn: () => [allowedOrigin],
    handleRequestFn: async () => createSuccessResult(),
    nowFn: () => ingressAtMs + directImageIngestionRequestBudgetMs,
  });

  for (const origin of ["https://unallowed.example", null]) {
    const result = await handler(
      createRestApiEvent(ingressAtMs, origin),
      createLambdaContext(directImageIngestionLambdaInvokeTimeoutMs),
    );
    assert.equal(result.statusCode, 503);
    assert.equal(result.headers?.["access-control-allow-origin"], undefined);
    assert.equal(
      result.headers?.["access-control-allow-credentials"],
      undefined,
    );
  }
});

test("invalid REST ingress timestamps return the stable response", async () => {
  for (const ingressAtMs of [
    0,
    -1,
    Number.MAX_SAFE_INTEGER,
  ]) {
    let handleCalls = 0;
    const handler = createDirectImageIngestionLambdaHandler({
      allowedOriginsFn: () => [allowedOrigin],
      handleRequestFn: async () => {
        handleCalls += 1;
        return createSuccessResult();
      },
      nowFn: () => 1_000_000,
    });

    const result = await handler(
      createRestApiEvent(ingressAtMs, allowedOrigin),
      createLambdaContext(directImageIngestionLambdaInvokeTimeoutMs),
    );

    assert.equal(result.statusCode, 503);
    assert.equal(
      JSON.parse(result.body).code,
      "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED",
    );
    assert.equal(handleCalls, 0);
  }
});

test("malformed HTTP API nesting returns the stable response", async () => {
  const ingressAtMs = 1_000_000;
  let handleCalls = 0;
  const handler = createDirectImageIngestionLambdaHandler({
    allowedOriginsFn: () => [allowedOrigin],
    handleRequestFn: async () => {
      handleCalls += 1;
      return createSuccessResult();
    },
    nowFn: () => ingressAtMs + 1,
  });

  const result = await handler(
    createHttpApiEvent(ingressAtMs, null),
    createLambdaContext(directImageIngestionLambdaInvokeTimeoutMs),
  );

  assert.equal(result.statusCode, 503);
  assert.equal(handleCalls, 0);
});

test("valid HTTP API event is parsed once with its nested method", () => {
  const ingressAtMs = 1_000_000;
  const parsed = parseDirectImageIngestionLambdaEvent(
    createHttpApiEvent(ingressAtMs, {
      method: "POST",
      path: directImagePath,
    }),
    createLambdaContext(directImageIngestionLambdaInvokeTimeoutMs),
  );

  assert.notEqual(parsed, null);
  assert.equal(parsed?.ingressAtMs, ingressAtMs);
  assert.equal(parsed?.requestId, "api-gateway-v2-request-1");
});
