import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { LangfuseObservation } from "@langfuse/tracing";
import * as Sentry from "@sentry/aws-serverless";
import OpenAI from "openai";
import { maximumImageIngestionOriginalBytes } from "../../mediaAssets/validators";
import {
  createBackendObservationScope,
} from "../../observability/sentry";
import {
  sentryModule,
} from "../../observability/sentry/testHelpers";
import { buildOpenAISafetyIdentifier } from "../openai/safetyIdentifier";
import {
  decodeGeneratedCardImageBase64,
  generatedCardImageModel,
  generatedCardImageOutputFormat,
  generatedCardImageQuality,
  generatedCardImageSize,
  OpenAIGeneratedCardImageProvider,
} from "./openaiAdapter";
import type {
  OpenAIImageGenerationInput,
} from "./providerTypes";
import { GeneratedCardImageDeadlineExceededError } from "./providerTypes";

type CapturedProviderRequest = Readonly<{
  method: string | null;
  path: string | null;
  authorization: string | null;
  contentType: string | null;
  body: unknown;
}>;

type ProviderRequestResponder = (
  request: CapturedProviderRequest,
  requestNumber: number,
  response: ServerResponse,
) => void | Promise<void>;

type ProviderTestServer = Readonly<{
  baseURL: string;
  requests: Array<CapturedProviderRequest>;
  handlerErrors: Array<Error>;
  waitForRequestCount: (expectedCount: number) => Promise<void>;
  close: () => Promise<void>;
}>;

type ProviderTelemetryCapture = Readonly<{
  cloudWatchLogs: Array<string>;
  cloudWatchWarnings: Array<string>;
  sentryBreadcrumbs: Array<Parameters<typeof Sentry.addBreadcrumb>[0]>;
  sentryContexts: Array<Readonly<{
    name: string;
    context: Parameters<Sentry.Scope["setContext"]>[1];
  }>>;
}>;

type MutableSentryTelemetryModule = typeof sentryModule & Readonly<{
  addBreadcrumb: typeof Sentry.addBreadcrumb;
}>;

type RecordedLangfuseTelemetry = Readonly<{
  rootObservation: LangfuseObservation;
  starts: Array<Readonly<{
    name: string;
    attributes: unknown;
    options: unknown;
  }>>;
  updates: Array<unknown>;
  getEndCount: () => number;
}>;

const providerRequestWaitTimeoutMs = 2_000;

function toRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }

  return value as Readonly<Record<string, unknown>>;
}

function parseJsonObject(value: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  return toRecord(parsed);
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.once("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.once("error", reject);
  });
}

function normalizeServerHandlerError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(`Provider test server handler threw a non-Error value: ${String(error)}`);
}

async function captureProviderRequest(request: IncomingMessage): Promise<CapturedProviderRequest> {
  const requestBody = await readRequestBody(request);
  return {
    method: request.method ?? null,
    path: request.url ?? null,
    authorization: request.headers.authorization ?? null,
    contentType: request.headers["content-type"] ?? null,
    body: parseJsonObject(requestBody),
  };
}

function createRequestCountWaiter(
  requests: ReadonlyArray<CapturedProviderRequest>,
  requestListeners: Set<() => void>,
  expectedCount: number,
): Promise<void> {
  if (requests.length >= expectedCount) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const handleRequest = (): void => {
      if (requests.length < expectedCount) {
        return;
      }

      clearTimeout(timeout);
      requestListeners.delete(handleRequest);
      resolve();
    };
    const timeout = setTimeout(() => {
      requestListeners.delete(handleRequest);
      reject(
        new Error(
          `Timed out waiting for ${expectedCount} provider requests; received ${requests.length}.`,
        ),
      );
    }, providerRequestWaitTimeoutMs);

    requestListeners.add(handleRequest);
  });
}

async function closeProviderTestServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
    server.closeAllConnections();
  });
}

async function startProviderTestServer(
  responder: ProviderRequestResponder,
): Promise<ProviderTestServer> {
  const requests: Array<CapturedProviderRequest> = [];
  const handlerErrors: Array<Error> = [];
  const requestListeners: Set<() => void> = new Set();
  const server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const capturedRequest = await captureProviderRequest(request);
      requests.push(capturedRequest);
      for (const listener of requestListeners) {
        listener();
      }

      await responder(capturedRequest, requests.length, response);
    })().catch((error: unknown) => {
      const handlerError = normalizeServerHandlerError(error);
      handlerErrors.push(handlerError);
      response.destroy(handlerError);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeProviderTestServer(server);
    throw new Error("Provider test server did not expose a TCP address.");
  }

  const tcpAddress = address as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${tcpAddress.port}/v1`,
    requests,
    handlerErrors,
    waitForRequestCount: async (expectedCount: number): Promise<void> => {
      await createRequestCountWaiter(requests, requestListeners, expectedCount);
    },
    close: async (): Promise<void> => {
      await closeProviderTestServer(server);
    },
  };
}

async function withProviderTestServer<Result>(
  responder: ProviderRequestResponder,
  run: (server: ProviderTestServer) => Promise<Result>,
): Promise<Result> {
  const server = await startProviderTestServer(responder);
  try {
    const result = await run(server);
    if (server.handlerErrors.length > 0) {
      throw server.handlerErrors[0];
    }

    return result;
  } finally {
    await server.close();
  }
}

function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  requestId: string,
  body: Readonly<Record<string, unknown>>,
): void {
  writeJsonResponseWithHeaders(response, statusCode, requestId, body, {});
}

function writeJsonResponseWithHeaders(
  response: ServerResponse,
  statusCode: number,
  requestId: string,
  body: Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>>,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "x-request-id": requestId,
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function writeRawResponse(
  response: ServerResponse,
  statusCode: number,
  requestId: string,
  contentType: string,
  body: string,
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "x-request-id": requestId,
  });
  response.end(body);
}

function createProvider(baseURL: string): OpenAIGeneratedCardImageProvider {
  const client = new OpenAI({
    apiKey: "test-openai-api-key",
    baseURL,
    maxRetries: 4,
  });
  return new OpenAIGeneratedCardImageProvider(client);
}

function createProviderWithFetch(fetch: typeof globalThis.fetch): OpenAIGeneratedCardImageProvider {
  return new OpenAIGeneratedCardImageProvider(
    new OpenAI({ apiKey: "test-openai-api-key", maxRetries: 4, fetch }),
  );
}
function createProviderInput(
  imagePrompt: string,
  signal: AbortSignal,
  rootObservation: LangfuseObservation | null,
): OpenAIImageGenerationInput {
  return {
    userId: "provider-test-user",
    imagePrompt,
    observationContext: {
      scope: createBackendObservationScope(
        "chat-worker",
        "lambda-request-provider-test",
        null,
        null,
        "provider-test-user",
        "provider-test-workspace",
        "provider-test-chat-request",
        "provider-test-run",
        "provider-test-session",
        null,
        null,
      ),
      rootObservation,
    },
    signal,
    operationDeadlineMs: Date.now() + 120_000,
  };
}

function createRecordedLangfuseTelemetry(): RecordedLangfuseTelemetry {
  const starts: RecordedLangfuseTelemetry["starts"] = [];
  const updates: RecordedLangfuseTelemetry["updates"] = [];
  let endCount = 0;
  const childObservation = {
    updateOtelSpanAttributes: (attributes: unknown): void => {
      updates.push(attributes);
    },
    end: (): void => {
      endCount += 1;
    },
  };
  const rootObservation = {
    startObservation: (name: string, attributes: unknown, options: unknown) => {
      starts.push({
        name,
        attributes,
        options,
      });
      return childObservation;
    },
  } as unknown as LangfuseObservation;

  return {
    rootObservation,
    starts,
    updates,
    getEndCount: (): number => endCount,
  };
}

async function withProviderTelemetryCapture<Result>(
  run: (capture: ProviderTelemetryCapture) => Promise<Result>,
): Promise<Readonly<{
  capture: ProviderTelemetryCapture;
  result: Result;
}>> {
  const capture: ProviderTelemetryCapture = {
    cloudWatchLogs: [],
    cloudWatchWarnings: [],
    sentryBreadcrumbs: [],
    sentryContexts: [],
  };
  const mutableSentryModule = sentryModule as MutableSentryTelemetryModule;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalAddBreadcrumb = mutableSentryModule.addBreadcrumb;
  const originalCaptureMessage = sentryModule.captureMessage;
  const originalSetContext = Sentry.Scope.prototype.setContext;

  console.log = (message?: unknown): void => {
    capture.cloudWatchLogs.push(typeof message === "string" ? message : String(message));
  };
  console.warn = (message?: unknown): void => {
    capture.cloudWatchWarnings.push(typeof message === "string" ? message : String(message));
  };
  mutableSentryModule.addBreadcrumb = (breadcrumb): void => {
    capture.sentryBreadcrumbs.push(breadcrumb);
  };
  sentryModule.captureMessage = (_message, _captureContext) => "provider-test-sentry-event";
  Sentry.Scope.prototype.setContext = function setContext(name, context) {
    capture.sentryContexts.push({
      name,
      context,
    });
    return this;
  };

  try {
    return {
      capture,
      result: await run(capture),
    };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    mutableSentryModule.addBreadcrumb = originalAddBreadcrumb;
    sentryModule.captureMessage = originalCaptureMessage;
    Sentry.Scope.prototype.setContext = originalSetContext;
  }
}

async function captureThrownError(promise: Promise<unknown>): Promise<Error> {
  let thrownError: unknown = null;
  let didThrow = false;
  try {
    await promise;
  } catch (error) {
    didThrow = true;
    thrownError = error;
  }

  if (didThrow === false || thrownError instanceof Error === false) {
    throw new Error("Expected provider call to throw an Error.");
  }

  return thrownError;
}

async function waitForCondition(
  predicate: () => boolean,
  failureMessage: string,
): Promise<void> {
  const deadline = Date.now() + providerRequestWaitTimeoutMs;
  while (predicate() === false) {
    if (Date.now() >= deadline) {
      throw new Error(failureMessage);
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

function getErrorField(error: Error, fieldName: string): unknown {
  return toRecord(error)[fieldName];
}

function countLangfuseResults(
  telemetry: RecordedLangfuseTelemetry,
  expectedResult: "success" | "error" | "aborted" | "deadline",
): number {
  return telemetry.updates.filter((update) => {
    const output = toRecord(update).output;
    return typeof output === "object"
      && output !== null
      && Array.isArray(output) === false
      && toRecord(output).result === expectedResult;
  }).length;
}

test("provider uses the official SDK request path and keeps provider telemetry content-free", async () => {
  const imagePrompt = "PRIVATE_PROVIDER_PROMPT_7e50b7ca";
  const imageBytes = Buffer.from("PRIVATE_PROVIDER_IMAGE_BYTES_92c57c18", "utf8");
  const providerBase64 = imageBytes.toString("base64");
  const langfuse = createRecordedLangfuseTelemetry();

  await withProviderTestServer(
    (_request, requestNumber, response) => {
      if (requestNumber === 1) {
        writeJsonResponseWithHeaders(
          response,
          429,
          "req_retry_1",
          {
            error: {
              message: "Rate limited.",
              type: "rate_limit_error",
              code: "rate_limit_exceeded",
              param: null,
            },
          },
          {
            "retry-after-ms": "10",
            "retry-after": "10",
          },
        );
        return;
      }

      writeJsonResponse(response, 200, "req_image_success", {
        created: 1_721_000_000,
        data: [{
          b64_json: providerBase64,
        }],
      });
    },
    async (server) => {
      const { capture, result } = await withProviderTelemetryCapture(async () => {
        return createProvider(server.baseURL).generate(
          createProviderInput(
            imagePrompt,
            new AbortController().signal,
            langfuse.rootObservation,
          ),
        );
      });

      assert.deepEqual(result.bytes, imageBytes);
      assert.equal(result.providerRequestId, "req_image_success");
      assert.equal(server.requests.length, 2);
      for (const request of server.requests) {
        assert.equal(request.method, "POST");
        assert.equal(request.path, "/v1/images/generations");
        assert.equal(request.authorization, "Bearer test-openai-api-key");
        assert.equal(request.contentType, "application/json");
        assert.deepEqual(request.body, {
          model: generatedCardImageModel,
          prompt: imagePrompt,
          n: 1,
          size: generatedCardImageSize,
          quality: generatedCardImageQuality,
          output_format: generatedCardImageOutputFormat,
          user: buildOpenAISafetyIdentifier("provider-test-user"),
        });
      }

      assert.equal(capture.cloudWatchWarnings.length, 1);
      assert.equal(capture.cloudWatchLogs.length, 1);
      assert.equal(
        capture.sentryContexts.filter((context) => context.name === "backend.details").length,
        1,
      );
      assert.equal(capture.sentryBreadcrumbs.length, 1);
      assert.equal(langfuse.starts.length, 1);
      assert.equal(langfuse.getEndCount(), 1);

      const retryRecord = parseJsonObject(capture.cloudWatchWarnings[0] ?? "");
      assert.equal(retryRecord.action, "generated_card_image_provider_retry");
      assert.equal(retryRecord.attempt, 1);
      assert.equal(retryRecord.maximumAttempts, 3);
      assert.equal(retryRecord.retryDelayMs, 10);
      assert.equal(retryRecord.providerStatus, 429);
      assert.equal(retryRecord.providerRequestId, "req_retry_1");
      assert.equal(retryRecord.errorClass, "RateLimitError");

      const completeRecord = parseJsonObject(capture.cloudWatchLogs[0] ?? "");
      assert.equal(completeRecord.action, "generated_card_image_provider_complete");
      assert.equal(completeRecord.attempt, 2);
      assert.equal(completeRecord.providerRequestId, "req_image_success");
      assert.equal(completeRecord.promptLength, imagePrompt.length);

      const serializedTelemetry = JSON.stringify({
        cloudWatchLogs: capture.cloudWatchLogs,
        cloudWatchWarnings: capture.cloudWatchWarnings,
        sentryBreadcrumbs: capture.sentryBreadcrumbs,
        sentryContexts: capture.sentryContexts,
        langfuseStarts: langfuse.starts,
        langfuseUpdates: langfuse.updates,
      });
      assert.equal(serializedTelemetry.includes(imagePrompt), false);
      assert.equal(serializedTelemetry.includes(providerBase64), false);
      assert.equal(serializedTelemetry.includes(imageBytes.toString("utf8")), false);
      assert.equal(serializedTelemetry.includes(`"promptLength":${imagePrompt.length}`), true);
    },
  );
});

test("provider requires exactly one non-empty base64 image", async () => {
  const invalidResponses: ReadonlyArray<Readonly<Record<string, unknown>>> = [
    {
      created: 1_721_000_000,
    },
    {
      created: 1_721_000_000,
      data: [],
    },
    {
      created: 1_721_000_000,
      data: [
        { b64_json: "YQ==" },
        { b64_json: "Yg==" },
      ],
    },
    {
      created: 1_721_000_000,
      data: [{}],
    },
    {
      created: 1_721_000_000,
      data: [{ b64_json: "  " }],
    },
    {
      created: 1_721_000_000,
      data: [{ b64_json: "/x==" }],
    },
  ];
  const malformedJsonBody = "PRIVATE_MALFORMED_JSON_RESPONSE_85be15e4";

  await withProviderTestServer(
    (_request, requestNumber, response) => {
      if (requestNumber === invalidResponses.length + 1) {
        writeRawResponse(
          response,
          200,
          "req_invalid_response_malformed_json",
          "application/json",
          malformedJsonBody,
        );
        return;
      }

      const responseBody = invalidResponses[requestNumber - 1];
      if (responseBody === undefined) {
        throw new Error(`Unexpected provider response request ${requestNumber}.`);
      }

      writeJsonResponse(response, 200, `req_invalid_response_${requestNumber}`, responseBody);
    },
    async (server) => {
      const { capture, result: errors } = await withProviderTelemetryCapture(async () => {
        const capturedErrors: Array<Error> = [];
        for (const _response of invalidResponses) {
          capturedErrors.push(
            await captureThrownError(
              createProvider(server.baseURL).generate(
                createProviderInput(
                  "Draw a provider response validation diagram.",
                  new AbortController().signal,
                  null,
                ),
              ),
            ),
          );
        }
        capturedErrors.push(
          await captureThrownError(
            createProvider(server.baseURL).generate(
              createProviderInput(
                "Draw a malformed JSON response diagram.",
                new AbortController().signal,
                null,
              ),
            ),
          ),
        );
        return capturedErrors;
      });

      assert.equal(server.requests.length, invalidResponses.length + 1);
      for (const [index, error] of errors.entries()) {
        assert.equal(error.name, "OpenAIImageGenerationError");
        assert.equal(getErrorField(error, "status"), 200);
        assert.equal(
          getErrorField(error, "requestID"),
          index < invalidResponses.length
            ? `req_invalid_response_${index + 1}`
            : "req_invalid_response_malformed_json",
        );
        assert.equal(getErrorField(error, "type"), "invalid_response");
        assert.equal(getErrorField(error, "code"), "invalid_image_response");
      }
      assert.equal(
        JSON.stringify(capture).includes(malformedJsonBody),
        false,
      );
    },
  );
});

test("base64 validation rejects malformed, noncanonical, and oversized provider data", () => {
  assert.deepEqual(
    decodeGeneratedCardImageBase64("/w=="),
    Buffer.from([0xff]),
  );
  assert.deepEqual(
    decodeGeneratedCardImageBase64("YWJj"),
    Buffer.from("abc", "utf8"),
  );

  assert.throws(
    () => decodeGeneratedCardImageBase64("/x=="),
    /invalid base64 image data/u,
  );
  assert.throws(
    () => decodeGeneratedCardImageBase64("YWJj\n"),
    /malformed base64 image data/u,
  );
  assert.throws(
    () => decodeGeneratedCardImageBase64("YWJj-_=="),
    /malformed base64 image data/u,
  );
  assert.throws(
    () => decodeGeneratedCardImageBase64("YQ"),
    /malformed base64 image data/u,
  );
  assert.throws(
    () => decodeGeneratedCardImageBase64(""),
    /malformed base64 image data/u,
  );

  const maximumEncodedImageCharacters = Math.ceil(maximumImageIngestionOriginalBytes / 3) * 4;
  assert.throws(
    () => decodeGeneratedCardImageBase64("A".repeat(maximumEncodedImageCharacters)),
    new RegExp(`maximum is ${maximumImageIngestionOriginalBytes}`, "u"),
  );
  assert.throws(
    () => decodeGeneratedCardImageBase64("A".repeat(maximumEncodedImageCharacters + 4)),
    new RegExp(`more than ${maximumImageIngestionOriginalBytes}`, "u"),
  );
});

test("provider makes exactly three attempts for transient 5xx failures", async () => {
  const transientStatuses = [500, 503, 599] as const;

  await withProviderTestServer(
    (_request, requestNumber, response) => {
      const statusCode = transientStatuses[requestNumber - 1];
      if (statusCode === undefined) {
        writeJsonResponse(response, 200, "req_unexpected_fourth_attempt", {
          created: 1_721_000_000,
          data: [{ b64_json: "YQ==" }],
        });
        return;
      }

      writeJsonResponseWithHeaders(
        response,
        statusCode,
        `req_transient_${requestNumber}`,
        {
          error: {
            message: "Provider unavailable.",
            type: "server_error",
            code: "provider_unavailable",
            param: null,
          },
        },
        requestNumber === 1
          ? { "retry-after": "0" }
          : { "retry-after-ms": "-1" },
      );
    },
    async (server) => {
      const { capture, result: error } = await withProviderTelemetryCapture(async () => {
        return captureThrownError(
          createProvider(server.baseURL).generate(
            createProviderInput(
              "Draw a transient retry diagram.",
              new AbortController().signal,
              null,
            ),
          ),
        );
      });

      assert.equal(server.requests.length, 3);
      assert.equal(capture.cloudWatchWarnings.length, 3);
      const warningRecords = capture.cloudWatchWarnings.map(parseJsonObject);
      assert.deepEqual(
        warningRecords.map((record) => record.action),
        [
          "generated_card_image_provider_retry",
          "generated_card_image_provider_retry",
          "generated_card_image_provider_failed",
        ],
      );
      assert.deepEqual(
        warningRecords.map((record) => record.attempt),
        [1, 2, 3],
      );
      assert.deepEqual(
        warningRecords.map((record) => record.retryDelayMs),
        [0, 1_000, null],
      );
      assert.deepEqual(
        warningRecords.map((record) => record.providerStatus),
        transientStatuses,
      );
      assert.deepEqual(
        warningRecords.map((record) => record.errorClass),
        ["InternalServerError", "InternalServerError", "InternalServerError"],
      );
      assert.equal(error.name, "OpenAIImageGenerationError");
      assert.equal(getErrorField(error, "status"), 599);
      assert.equal(getErrorField(error, "requestID"), "req_transient_3");
      assert.equal(getErrorField(error, "type"), "server_error");
      assert.equal(getErrorField(error, "code"), "provider_unavailable");
    },
  );
});

test("native SDK connection timeout retries and preserves terminal timeout classification", async () => {
  const successBytes = Buffer.from("native timeout retry success"); let successFetchCalls = 0;
  const result = await createProviderWithFetch(async () => {
    if (++successFetchCalls === 1) throw new DOMException("socket timed out", "TimeoutError");
    return new Response(JSON.stringify({ data: [{ b64_json: successBytes.toString("base64") }] }),
      { status: 200, headers: { "content-type": "application/json",
        "x-request-id": "req_native_timeout_success" } });
  }).generate(createProviderInput("Draw a native timeout retry diagram.",
    new AbortController().signal, null));
  assert.deepEqual(result.bytes, successBytes); assert.equal(successFetchCalls, 2);
  let exhaustedFetchCalls = 0;
  const exhaustedError = await captureThrownError(createProviderWithFetch(async () => {
    exhaustedFetchCalls += 1;
    throw new DOMException("socket timed out", "TimeoutError");
  }).generate(createProviderInput("Draw an exhausted native timeout diagram.",
    new AbortController().signal, null)));
  assert.equal(exhaustedFetchCalls, 3); assert.equal(exhaustedError.name, "OpenAIImageGenerationError");
  assert.equal(getErrorField(exhaustedError, "status"), null);
  assert.equal(exhaustedError instanceof GeneratedCardImageDeadlineExceededError, false);
});
test("provider does not retry invalid, authentication, permission, conflict, or moderation failures", async () => {
  const failureCases = [
    {
      statusCode: 400,
      requestId: "req_invalid_request",
      error: {
        message: "Invalid size.",
        type: "invalid_request_error",
        code: "invalid_size",
        param: "size",
      },
    },
    {
      statusCode: 401,
      requestId: "req_authentication",
      error: {
        message: "Invalid API key.",
        type: "authentication_error",
        code: "invalid_api_key",
        param: null,
      },
    },
    {
      statusCode: 403,
      requestId: "req_permission",
      error: {
        message: "Model access denied.",
        type: "permission_error",
        code: "model_not_allowed",
        param: "model",
      },
    },
    {
      statusCode: 409,
      requestId: "req_conflict",
      error: {
        message: "Request conflict.",
        type: "conflict_error",
        code: "request_conflict",
        param: null,
      },
    },
    {
      statusCode: 400,
      requestId: "req_moderation",
      error: {
        message: "Image generation blocked.",
        type: "image_generation_user_error",
        code: "moderation_blocked",
        param: "prompt",
        moderation_details: {
          moderation_stage: "input",
          categories: ["harassment", "violence"],
        },
      },
    },
  ] as const;

  await withProviderTestServer(
    (_request, requestNumber, response) => {
      const failureCase = failureCases[requestNumber - 1];
      if (failureCase === undefined) {
        throw new Error(`Unexpected non-retry request ${requestNumber}.`);
      }

      writeJsonResponse(response, failureCase.statusCode, failureCase.requestId, {
        error: failureCase.error,
      });
    },
    async (server) => {
      const { capture, result: errors } = await withProviderTelemetryCapture(async () => {
        const capturedErrors: Array<Error> = [];
        for (const _failureCase of failureCases) {
          capturedErrors.push(
            await captureThrownError(
              createProvider(server.baseURL).generate(
                createProviderInput(
                  "Draw a non-retry status diagram.",
                  new AbortController().signal,
                  null,
                ),
              ),
            ),
          );
        }
        return capturedErrors;
      });

      assert.equal(server.requests.length, failureCases.length);
      assert.equal(capture.cloudWatchWarnings.length, failureCases.length);
      for (const [index, failureCase] of failureCases.entries()) {
        const error = errors[index];
        if (error === undefined) {
          throw new Error(`Missing captured error for failure case ${index}.`);
        }

        assert.equal(error.name, "OpenAIImageGenerationError");
        assert.equal(getErrorField(error, "status"), failureCase.statusCode);
        assert.equal(getErrorField(error, "requestID"), failureCase.requestId);
        assert.equal(getErrorField(error, "type"), failureCase.error.type);
        assert.equal(getErrorField(error, "code"), failureCase.error.code);
        assert.equal(getErrorField(error, "param"), failureCase.error.param);

        const warningRecord = parseJsonObject(capture.cloudWatchWarnings[index] ?? "");
        assert.equal(warningRecord.action, "generated_card_image_provider_failed");
        assert.equal(warningRecord.attempt, 1);
        assert.equal(warningRecord.retryDelayMs, null);
      }

      const moderationError = errors[4];
      if (moderationError === undefined) {
        throw new Error("Missing moderation error.");
      }
      assert.equal(getErrorField(moderationError, "moderationStage"), "input");
      assert.deepEqual(
        getErrorField(moderationError, "moderationCategories"),
        ["harassment", "violence"],
      );
    },
  );
});

test("provider aborts the in-flight SDK request without retrying", async () => {
  await withProviderTestServer(
    (_request, _requestNumber, _response) => {
      // Keep the response open until the client-side AbortSignal closes the request.
    },
    async (server) => {
      const controller = new AbortController();
      const langfuse = createRecordedLangfuseTelemetry();
      const { capture, result: error } = await withProviderTelemetryCapture(async () => {
        const providerCall = createProvider(server.baseURL).generate(
          createProviderInput(
            "Draw an in-flight abort diagram.",
            controller.signal,
            langfuse.rootObservation,
          ),
        );
        await server.waitForRequestCount(1);
        controller.abort(new Error("Chat run stopped during image generation."));
        return captureThrownError(providerCall);
      });

      assert.equal(error instanceof OpenAI.APIUserAbortError, true);
      assert.equal(server.requests.length, 1);
      assert.equal(capture.cloudWatchWarnings.length, 0);
      assert.equal(capture.cloudWatchLogs.length, 0);
      assert.equal(countLangfuseResults(langfuse, "aborted"), 1);
      assert.equal(langfuse.getEndCount(), 1);
    },
  );
});

test("provider preserves a known 429 when the remaining budget cannot fit a retry", async () => {
  await withProviderTestServer(
    (_request, _requestNumber, response) => writeJsonResponse(response, 429,
      "req_insufficient_retry_budget",
      { error: { message: "Rate limited.", type: "rate_limit_error", code: "rate_limit_exceeded" } }),
    async (server) => {
      const input = createProviderInput("Draw a bounded retry diagram.",
        new AbortController().signal, null);
      const error = await captureThrownError(createProvider(server.baseURL).generate(
        { ...input, operationDeadlineMs: Date.now() + 35_000 }));
      assert.equal(server.requests.length, 1); assert.equal(error.name, "OpenAIImageGenerationError");
      assert.equal(getErrorField(error, "status"), 429);
      assert.equal(getErrorField(error, "requestID"), "req_insufficient_retry_budget");
    },
  );
});

test("provider reports a true request deadline distinctly", async () => {
  await withProviderTestServer(
    (_request, _requestNumber, _response) => {
      // Keep the response open until the bounded provider timeout aborts it.
    },
    async (server) => {
      const input = createProviderInput("Draw a provider deadline diagram.",
        new AbortController().signal, null);
      const error = await captureThrownError(createProvider(server.baseURL).generate(
        { ...input, operationDeadlineMs: Date.now() + 30_500 }));
      assert.equal(error instanceof GeneratedCardImageDeadlineExceededError, true);
      assert.equal(server.requests.length, 1);
    },
  );
});

test("provider aborts explicit backoff before a second request", async () => {
  const futureRetryDate = new Date(Date.now() + 60_000).toUTCString();
  await withProviderTestServer(
    (_request, requestNumber, response) => {
      writeJsonResponseWithHeaders(
        response,
        429,
        `req_backoff_abort_${requestNumber}`,
        {
          error: {
            message: "Rate limited.",
            type: "rate_limit_error",
            code: "rate_limit_exceeded",
            param: null,
          },
        },
        { "retry-after": futureRetryDate },
      );
    },
    async (server) => {
      const controller = new AbortController();
      const abortReason = new Error("Chat run stopped during image retry backoff.");
      const langfuse = createRecordedLangfuseTelemetry();
      const { capture, result: error } = await withProviderTelemetryCapture(async (telemetry) => {
        const providerCall = createProvider(server.baseURL).generate(
          createProviderInput(
            "Draw an abortable retry diagram.",
            controller.signal,
            langfuse.rootObservation,
          ),
        );
        await waitForCondition(
          () => telemetry.cloudWatchWarnings.some(
            (message) => message.includes('"action":"generated_card_image_provider_retry"'),
          ),
          "Provider did not enter explicit retry backoff.",
        );
        controller.abort(abortReason);
        return captureThrownError(providerCall);
      });

      assert.equal(error, abortReason);
      assert.equal(server.requests.length, 1);
      assert.equal(capture.cloudWatchWarnings.length, 1);
      assert.equal(capture.cloudWatchLogs.length, 0);
      assert.equal(
        parseJsonObject(capture.cloudWatchWarnings[0] ?? "").retryDelayMs,
        30_000,
      );
      assert.equal(countLangfuseResults(langfuse, "aborted"), 1);
      assert.equal(langfuse.getEndCount(), 1);
    },
  );
});

test("provider records a pre-aborted request exactly once without calling OpenAI", async () => {
  await withProviderTestServer(
    (_request, requestNumber, _response) => {
      throw new Error(`Unexpected pre-aborted provider request ${requestNumber}.`);
    },
    async (server) => {
      const controller = new AbortController();
      const abortReason = new Error("Chat run stopped before image generation.");
      const langfuse = createRecordedLangfuseTelemetry();
      controller.abort(abortReason);

      const { capture, result: error } = await withProviderTelemetryCapture(async () => {
        return captureThrownError(
          createProvider(server.baseURL).generate(
            createProviderInput(
              "Draw a pre-aborted provider diagram.",
              controller.signal,
              langfuse.rootObservation,
            ),
          ),
        );
      });

      assert.equal(error, abortReason);
      assert.equal(server.requests.length, 0);
      assert.equal(capture.cloudWatchWarnings.length, 0);
      assert.equal(capture.cloudWatchLogs.length, 0);
      assert.equal(countLangfuseResults(langfuse, "aborted"), 1);
      assert.equal(langfuse.getEndCount(), 1);
    },
  );
});
