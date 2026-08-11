import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { Context } from "aws-lambda";
import type { APIGatewayProxyResult, LambdaEvent } from "hono/aws-lambda";
import { handler } from "./lambda";

const allowedOrigin = "https://app.flashcards-open-source-app.com";
const directPath =
  "/v1/v1/workspaces/11111111-1111-4111-8111-111111111111/media-assets/images/";

function createLambdaContext(): Context {
  return {
    awsRequestId: "lambda-request-1",
    callbackWaitsForEmptyEventLoop: true,
    getRemainingTimeInMillis: () => 900_000,
  } as Context;
}

function createDirectImageRestEvent(
  headers: Readonly<Record<string, string>>,
  bodyRead: () => void,
): LambdaEvent {
  const event: Record<string, unknown> = {
    version: "1.0",
    httpMethod: "POST",
    path: directPath,
    headers,
    requestContext: {
      requestId: "api-gateway-request-1",
      httpMethod: "POST",
      path: `/v1${directPath}`,
      stage: "v1",
    },
  };
  Object.defineProperty(event, "body", {
    enumerable: true,
    get: () => {
      bodyRead();
      throw new Error("Shared direct-image guard read the request body.");
    },
  });
  return event as unknown as LambdaEvent;
}

async function invokeHandler(event: LambdaEvent): Promise<APIGatewayProxyResult> {
  const result = await handler(event, createLambdaContext(), () => {});
  if (result === undefined) {
    throw new Error("Shared backend Lambda handler returned no result.");
  }
  return result;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test("shared Lambda rejects direct-image POST before app bootstrap or body work with browser CORS", async () => {
  const originalAllowedOrigins = process.env.BACKEND_ALLOWED_ORIGINS;
  const originalAuthMode = process.env.AUTH_MODE;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.BACKEND_ALLOWED_ORIGINS = allowedOrigin;
  process.env.AUTH_MODE = "guard-must-not-bootstrap";
  delete process.env.DATABASE_URL;
  let bodyReads = 0;

  try {
    const result = await invokeHandler(createDirectImageRestEvent(
      {
        Origin: allowedOrigin,
        "X-Request-Id": "client-forged-request-id",
      },
      () => {
        bodyReads += 1;
      },
    ));
    const body = JSON.parse(result.body) as Readonly<{
      error: string;
      requestId: string;
      code: string;
    }>;

    assert.equal(result.statusCode, 404);
    assert.equal(result.isBase64Encoded, false);
    assert.equal(
      result.headers?.["content-type"],
      "application/json; charset=UTF-8",
    );
    assert.equal(
      result.headers?.["x-request-id"],
      "api-gateway-request-1",
    );
    assert.equal(
      result.headers?.["access-control-allow-origin"],
      allowedOrigin,
    );
    assert.equal(
      result.headers?.["access-control-allow-credentials"],
      "true",
    );
    assert.equal(
      body.error,
      "Direct image ingestion is available only through its bounded API route.",
    );
    assert.equal(body.requestId, "api-gateway-request-1");
    assert.equal(
      body.code,
      "DIRECT_IMAGE_INGESTION_ROUTE_UNAVAILABLE",
    );
    assert.equal(bodyReads, 0);
  } finally {
    restoreEnv("BACKEND_ALLOWED_ORIGINS", originalAllowedOrigins);
    restoreEnv("AUTH_MODE", originalAuthMode);
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
  }
});

test("shared Lambda returns the published agent envelope to API-key callers", async () => {
  const originalPublicApiBaseUrl = process.env.PUBLIC_API_BASE_URL;
  process.env.PUBLIC_API_BASE_URL =
    "https://api.flashcards-open-source-app.com/v1";

  try {
    const result = await invokeHandler(createDirectImageRestEvent(
      { Authorization: "ApiKey invalid" },
      () => {},
    ));
    const body = JSON.parse(result.body) as Readonly<{
      ok: boolean;
      data: Readonly<Record<string, never>>;
      instructions: string;
      docs: Readonly<{
        discoveryUrl: string;
        source: Readonly<{ repositoryUrl: string }>;
      }>;
      error: Readonly<{ code: string; message: string }>;
      requestId: string;
    }>;

    assert.equal(result.statusCode, 404);
    assert.equal(body.ok, false);
    assert.deepEqual(body.data, {});
    assert.equal(
      body.error.code,
      "DIRECT_IMAGE_INGESTION_ROUTE_UNAVAILABLE",
    );
    assert.equal(
      body.error.message,
      "Direct image ingestion is available only through its bounded API route.",
    );
    assert.equal(
      body.instructions,
      "Verify that the referenced resource id exists in the selected workspace, then retry only after correcting the id.",
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
    restoreEnv("PUBLIC_API_BASE_URL", originalPublicApiBaseUrl);
  }
});

test("shared direct-image guard remains before lazy runtime initialization", () => {
  const source = readFileSync(resolve(__dirname, "lambda.ts"), "utf8");
  const handlerStart = source.indexOf(
    "const backendApiBootstrapHandler: BackendApiHandler",
  );
  const guardStart = source.indexOf(
    "isDirectImageIngestionPostTarget(readApiGatewayRequestTarget(event))",
    handlerStart,
  );
  const runtimeStart = source.indexOf(
    "runtime = await getBackendApiRuntime()",
    handlerStart,
  );

  assert.notEqual(handlerStart, -1);
  assert.notEqual(guardStart, -1);
  assert.notEqual(runtimeStart, -1);
  assert.ok(guardStart < runtimeStart);
});
