import assert from "node:assert/strict";
import test from "node:test";
import type { LangfuseObservation } from "@langfuse/tracing";
import OpenAI from "openai";
import { maximumImageIngestionOriginalBytes } from "../../../mediaAssets/validators";
import {
  createBackendObservationScope,
} from "../../../observability/sentry";
import { buildOpenAISafetyIdentifier } from "../../openai/safetyIdentifier";
import {
  decodeGeneratedCardImageBase64,
  generatedCardImageModel,
  generatedCardImageOutputFormat,
  generatedCardImageQuality,
  generatedCardImageSize,
  isOpenAIImageGenerationProviderError,
  OpenAIGeneratedCardImageProvider,
  OpenAIImageGenerationResponseError,
} from "./openaiAdapter";
import type {
  OpenAIImageGenerationInput,
} from "./providerTypes";
import { GeneratedCardImageDeadlineExceededError } from "../providerTypes";
import {
  createRecordedLangfuseTelemetry,
  type RecordedLangfuseTelemetry,
  withProviderTelemetryCapture,
} from "./providerTelemetryCapture.testSupport";
import {
  withProviderTestServer,
  writeJsonResponse,
  writeJsonResponseWithHeaders,
  writeRawResponse,
} from "./providerTestServer.testSupport";

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

test("provider preserves unexpected SDK invocation errors unchanged", async () => {
  const unexpectedError = new Error(
    "OpenAI image SDK invocation failed before returning a provider request.",
  );
  const client = {
    images: {
      generate: (): never => {
        throw unexpectedError;
      },
    },
  } as unknown as OpenAI;

  await assert.rejects(
    new OpenAIGeneratedCardImageProvider(client).generate(
      createProviderInput(
        "Draw an unexpected SDK invocation diagram.",
        new AbortController().signal,
        null,
      ),
    ),
    (error: unknown) => error === unexpectedError,
  );
});

test("provider preserves base and unselected OpenAI SDK errors unchanged", async () => {
  class UnselectedBadRequestError extends OpenAI.BadRequestError {}

  const headers = new Headers({ "x-request-id": "req_unselected_sdk_error" });
  const baseCause = new Error("Unexpected base API error cause.");
  const subclassCause = new Error("Unexpected SDK subclass cause.");
  const unexpectedErrors = [
    Object.assign(
      new OpenAI.APIError(
        418,
        { message: "Unexpected base API error." },
        "Unexpected base API error.",
        headers,
      ),
      { cause: baseCause },
    ),
    Object.assign(
      new UnselectedBadRequestError(
        400,
        { message: "Unexpected SDK subclass error." },
        "Unexpected SDK subclass error.",
        headers,
      ),
      { cause: subclassCause },
    ),
  ] as const;

  for (const unexpectedError of unexpectedErrors) {
    const client = {
      images: {
        generate: (): never => {
          throw unexpectedError;
        },
      },
    } as unknown as OpenAI;

    const capturedError = await captureThrownError(
      new OpenAIGeneratedCardImageProvider(client).generate(
        createProviderInput(
          "Draw an unexpected SDK error diagram.",
          new AbortController().signal,
          null,
        ),
      ),
    );
    assert.equal(capturedError, unexpectedError);
    assert.equal(capturedError.cause, unexpectedError.cause);
  }
});

test("provider preserves unexpected telemetry failures after a successful request", async () => {
  const unexpectedError = new Error(
    "Generated-image provider telemetry update failed.",
  );
  const childObservation = {
    updateOtelSpanAttributes: (): never => {
      throw unexpectedError;
    },
    end: (): void => undefined,
  };
  const rootObservation = {
    startObservation: () => childObservation,
  } as unknown as LangfuseObservation;

  await withProviderTestServer(
    (_request, _requestNumber, response) => {
      writeJsonResponse(response, 200, "req_unexpected_telemetry", {
        created: 1_721_000_000,
        data: [{ b64_json: Buffer.from("image").toString("base64") }],
      });
    },
    async (server) => {
      const { result: error } = await withProviderTelemetryCapture(async () =>
        captureThrownError(
          createProvider(server.baseURL).generate(
            createProviderInput(
              "Draw an unexpected telemetry diagram.",
              new AbortController().signal,
              rootObservation,
            ),
          ),
        ));

      assert.equal(server.requests.length, 1);
      assert.equal(error, unexpectedError);
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
        assert.ok(error instanceof OpenAIImageGenerationResponseError);
        assert.equal(error.name, "OpenAIImageGenerationResponseError");
        assert.equal(isOpenAIImageGenerationProviderError(error), false);
        assert.equal(getErrorField(error, "status"), 200);
        assert.equal(
          getErrorField(error, "requestID"),
          index < invalidResponses.length
            ? `req_invalid_response_${index + 1}`
            : "req_invalid_response_malformed_json",
        );
        assert.equal(getErrorField(error, "type"), "invalid_response");
        assert.equal(getErrorField(error, "code"), "invalid_image_response");
        assert.ok(getErrorField(error, "cause") instanceof Error);
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
      errorConstructor: OpenAI.BadRequestError,
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
      errorConstructor: OpenAI.AuthenticationError,
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
      errorConstructor: OpenAI.PermissionDeniedError,
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
      errorConstructor: OpenAI.ConflictError,
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
      errorConstructor: OpenAI.BadRequestError,
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
        const providerCause = getErrorField(error, "cause");
        assert.ok(providerCause instanceof Error);
        assert.equal(providerCause.constructor, failureCase.errorConstructor);

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
