import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import {
  DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
} from "../../../aiTools/agentSql/operations";
import {
  DatabaseDeadlineExceededError,
  DatabaseTransactionRolledBackError,
} from "../../../database";
import {
  DatabaseCommitOutcomeUnknownError,
  TransientDatabaseHttpError,
} from "../../../database/transient";
import {
  GeneratedMediaPromotionStorageTerminalError,
  GeneratedMediaPromotionStorageTransientError,
} from "../../../mediaAssets/storage";
import { createBackendObservationScope } from "../../../observability/sentry";
import { HttpError } from "../../../shared/errors";
import { InactiveChatRunClaimError } from "../../runs";
import {
  buildOpenAIChatTools,
  executeChatToolCallWithDependencies,
  type OpenAIToolContext,
  type OpenAIToolDependencies,
} from "./tools";
import {
  GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR,
  GENERATED_IMAGE_TOOL_NAME,
  OPENAI_GENERATED_IMAGE_TOOL,
} from "./generatedImageToolContract";
import {
  generatedImageAltTextJsonSchemaPattern,
  maximumGeneratedImageAltTextCodePoints,
} from "../../cardImages/contract";
import {
  OpenAIGeneratedCardImageProvider,
  OpenAIImageGenerationResponseError,
} from "../../cardImages/provider/openaiAdapter";
import {
  GeneratedCardImageDeadlineExceededError,
  GeneratedCardImageProviderOutcomeUnknownError,
  GeneratedCardImageStagingOutcomeUnknownError,
} from "../../cardImages/providerTypes";

const runId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const cardId = "44444444-4444-4444-8444-444444444444";
const mediaAssetId = "66666666-6666-4666-8666-666666666666";
const replicaId = "55555555-5555-4555-8555-555555555555";

const context: OpenAIToolContext = {
  runId,
  sessionId,
  userId: "signed-in-user",
  workspaceId,
  claimToken: "2026-07-24 10:11:12.123456+00",
  operationKey: "generated-image:1",
  generatedImageEligible: true,
  signal: new AbortController().signal,
  generatedImageOperationDeadlineMs: Date.now() + 120_000,
  generatedImageObservationContext: {
    scope: createBackendObservationScope(
      "chat-worker",
      null,
      null,
      null,
      "signed-in-user",
      workspaceId,
      "request-1",
      runId,
      sessionId,
      null,
      null,
    ),
    rootObservation: null,
  },
};

const validArgumentObject = {
  cardId,
  targetSide: "back",
  imagePrompt: "Draw a labeled mitosis diagram.",
  altText: "Labeled stages of mitosis",
} as const;
const validArguments = JSON.stringify(validArgumentObject);
const invalidControlCharacterAltTexts = [
  "line\nbreak",
  "tab\ttext",
  "\nleading-c0",
  "trailing-c0\t",
  "nul\u0000text",
  "unit\u001fseparator",
  "\u007fleading-del",
  "trailing-del\u007f",
  "delete\u007ftext",
  "\u0085leading-c1",
  "trailing-c1\u009f",
  "c1\u009ftext",
] as const;
const rawOverLimitAltText =
  ` ${"😀".repeat(maximumGeneratedImageAltTextCodePoints)} `;
const invalidRawAltTexts = [
  ...invalidControlCharacterAltTexts,
  rawOverLimitAltText,
] as const;

const dependencies: OpenAIToolDependencies = {
  executeAgentSql: async () => {
    throw new Error("SQL was not expected.");
  },
  createToolDependencies: () => DEFAULT_AGENT_TOOL_OPERATION_DEPENDENCIES,
  reserveGeneratedCardImageAttempt: async () => ({
    status: "reserved",
    attempt: 1,
    payload: null,
  }),
  bindGeneratedCardImageAttemptPayload: async (params) => params.payload,
  hasCognitoIdentityMappingForUser: async () => true,
  ensureAIChatSyncReplicaWithDeadline: async () => replicaId,
  generateCardImage: async (input) => ({
    status: "queued",
    cardId: input.cardId,
    targetSide: input.targetSide,
    mediaAssetId,
    mediaRegistrationApplied: false,
    cardAppendApplied: false,
    placeholderApplied: true,
    reused: false,
    sourceUrl: null,
  }),
};

function executeImage(
  rawArguments: string,
  toolContext: OpenAIToolContext,
  overrides: Partial<OpenAIToolDependencies>,
) {
  return executeChatToolCallWithDependencies(
    GENERATED_IMAGE_TOOL_NAME,
    rawArguments,
    toolContext,
    { ...dependencies, ...overrides },
  );
}

test("generated image tool schema is strict and signed-in-only", () => {
  assert.equal(OPENAI_GENERATED_IMAGE_TOOL.strict, true);
  assert.deepEqual(
    OPENAI_GENERATED_IMAGE_TOOL.parameters?.required,
    ["cardId", "targetSide", "imagePrompt", "altText"],
  );
  assert.equal(OPENAI_GENERATED_IMAGE_TOOL.parameters?.additionalProperties, false);
  assert.equal(GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR.safeParse({
    ...validArgumentObject,
    unexpected: true,
  }).success, false);

  const parameters = OPENAI_GENERATED_IMAGE_TOOL.parameters as {
    properties: { altText: { maxLength: number; pattern: string } };
  };
  assert.equal(
    parameters.properties.altText.pattern,
    generatedImageAltTextJsonSchemaPattern,
  );
  assert.equal(
    parameters.properties.altText.maxLength,
    maximumGeneratedImageAltTextCodePoints,
  );
  for (const altText of [
    "   ",
    rawOverLimitAltText,
  ]) {
    assert.equal(GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR.safeParse({
      ...validArgumentObject,
      altText,
    }).success, false);
  }
  const schemaAltTextPattern = new RegExp(
    parameters.properties.altText.pattern,
    "u",
  );
  for (const altText of invalidControlCharacterAltTexts) {
    assert.equal(schemaAltTextPattern.test(altText), false);
    assert.equal(GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR.safeParse({
      ...validArgumentObject,
      altText,
    }).success, false);
  }

  const maximumRawUnicodeText =
    ` ${"😀".repeat(maximumGeneratedImageAltTextCodePoints - 2)} `;
  assert.equal(schemaAltTextPattern.test(maximumRawUnicodeText), true);
  assert.equal(GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR.parse({
    ...validArgumentObject,
    altText: maximumRawUnicodeText,
  }).altText, maximumRawUnicodeText.trim());
  assert.equal(GENERATED_IMAGE_TOOL_ARGUMENT_VALIDATOR.safeParse({
    ...validArgumentObject,
    altText: "😀".repeat(maximumGeneratedImageAltTextCodePoints + 1),
  }).success, false);
  assert.deepEqual(buildOpenAIChatTools(false).map((tool) => tool.name), ["sql"]);
  assert.deepEqual(
    buildOpenAIChatTools(true).map((tool) => tool.name),
    ["sql", "add_generated_image_to_card"],
  );
});

test("invalid raw alt text is rejected before immutable binding or external work", async () => {
  for (const altText of invalidRawAltTexts) {
    const calls: Array<string> = [];
    const result = await executeImage(
      JSON.stringify({ ...validArgumentObject, altText }),
      context,
      {
        reserveGeneratedCardImageAttempt: async () => {
          calls.push("reserve");
          return { status: "reserved", attempt: 1, payload: null };
        },
        bindGeneratedCardImageAttemptPayload: async (params) => {
          calls.push("bind");
          return params.payload;
        },
        hasCognitoIdentityMappingForUser: async () => {
          calls.push("identity");
          return true;
        },
      },
    );

    assert.deepEqual(calls, ["reserve"]);
    assert.equal(JSON.parse(result.output).code, "invalid_arguments");
  }
});

test("generated image execution reserves and binds before identity or external work", async () => {
  const calls: Array<string> = [];
  const result = await executeImage(validArguments, context, {
    reserveGeneratedCardImageAttempt: async (params) => {
      calls.push("reserve");
      assert.equal(params.operationKey, context.operationKey);
      assert.equal(params.claimToken, context.claimToken);
      return { status: "reserved", attempt: 2, payload: null };
    },
    bindGeneratedCardImageAttemptPayload: async (params) => {
      calls.push("bind");
      assert.deepEqual(params.payload, validArgumentObject);
      return params.payload;
    },
    hasCognitoIdentityMappingForUser: async (_userId, deadline) => {
      calls.push("identity");
      assert.equal(deadline, context.generatedImageOperationDeadlineMs);
      return true;
    },
    ensureAIChatSyncReplicaWithDeadline: async (
      _workspaceId,
      _userId,
      _platform,
      signal,
      deadline,
    ) => {
      calls.push("replica");
      assert.equal(signal.aborted, false);
      assert.equal(deadline, context.generatedImageOperationDeadlineMs);
      return replicaId;
    },
    generateCardImage: async (input) => {
      calls.push("generate");
      assert.equal(input.operationKey, context.operationKey);
      assert.equal(input.operationDeadlineMs, context.generatedImageOperationDeadlineMs);
      return dependencies.generateCardImage(input);
    },
  });

  assert.deepEqual(calls, ["reserve", "bind", "identity", "replica", "generate"]);
  assert.deepEqual(
    [
      JSON.parse(result.output).status,
      JSON.parse(result.output).placeholderApplied,
      result.succeeded,
      result.shouldInvalidateMainContent,
      /fcasset|base64|imagePrompt/u.test(result.output),
    ],
    ["queued", true, true, true, false],
  );
});

test("reclaimed execution reuses immutable payload when model wording changes", async () => {
  const originalPayload = {
    ...validArgumentObject,
    imagePrompt: "Original immutable prompt.",
    altText: "Original immutable alt text",
  };
  let bindCallCount = 0;
  const result = await executeImage("{regenerated-invalid-json", context, {
    reserveGeneratedCardImageAttempt: async () => ({
      status: "reserved",
      attempt: 1,
      payload: originalPayload,
    }),
    bindGeneratedCardImageAttemptPayload: async (params) => {
      bindCallCount += 1;
      return params.payload;
    },
    generateCardImage: async (input) => {
      assert.equal(input.imagePrompt, originalPayload.imagePrompt);
      assert.equal(input.altText, originalPayload.altText);
      return {
        ...await dependencies.generateCardImage(input),
        status: "already_queued",
        placeholderApplied: false,
        reused: true,
      };
    },
  });

  assert.equal(bindCallCount, 0);
  assert.equal(JSON.parse(result.output).status, "already_queued");
  assert.equal(JSON.parse(result.output).placeholderApplied, false);
  assert.equal(result.shouldInvalidateMainContent, false);
});

test("guest execution rejects before every generated-image dependency", async () => {
  const calls: Array<string> = [];
  const failDependency = (dependencyName: string): never => {
    calls.push(dependencyName);
    throw new Error(`Guest execution called ${dependencyName}.`);
  };
  const result = await executeImage(
    "{invalid",
    { ...context, generatedImageEligible: false },
    {
      executeAgentSql: async () => failDependency("sql"),
      createToolDependencies: () => failDependency("tool_dependencies"),
      reserveGeneratedCardImageAttempt: async () => failDependency("reserve"),
      bindGeneratedCardImageAttemptPayload: async () => failDependency("bind"),
      hasCognitoIdentityMappingForUser: async () => failDependency("identity"),
      ensureAIChatSyncReplicaWithDeadline: async () => failDependency("replica"),
      generateCardImage: async () => failDependency("generate"),
    },
  );

  assert.deepEqual(calls, []);
  assert.equal(JSON.parse(result.output).code, "sign_in_required");
  assert.deepEqual(result.generatedImageTelemetry, {
    attempt: null,
    status: "sign_in_required",
  });
});

test("reservation outcomes remain distinct", async () => {
  for (const reservation of [
    { status: "run_inactive" as const },
    { status: "limit_reached" as const },
    { status: "reserved" as const, attempt: 3 as const, payload: null },
  ]) {
    const result = await executeImage("{invalid", context, {
      reserveGeneratedCardImageAttempt: async () => reservation,
    });
    assert.equal(JSON.parse(result.output).retryable, false);
    assert.equal(
      result.stopReason,
      reservation.status === "run_inactive" ? "run_inactive" : null,
    );
  }

});

test("generated image tool maps only the exact operation deadline reason", async () => {
  const subDeadlineErrors = [
    new DOMException(
      "A dependency reached its own timeout.",
      "TimeoutError",
    ),
    new DatabaseDeadlineExceededError(
      "pool_checkout",
      context.generatedImageOperationDeadlineMs,
      null,
    ),
    new GeneratedCardImageDeadlineExceededError(
      new Error("The provider request reserve expired."),
    ),
  ];
  for (const subDeadlineError of subDeadlineErrors) {
    await assert.rejects(
      executeImage(validArguments, context, {
        generateCardImage: async () => {
          throw subDeadlineError;
        },
      }),
      (error: unknown) => error === subDeadlineError,
    );
  }

  const deadlineResult = await executeImage(
    validArguments,
    {
      ...context,
      generatedImageOperationDeadlineMs: Date.now() + 100,
    },
    {
      generateCardImage: async (input) => {
        if (input.signal.aborted === false) {
          await new Promise<void>((resolve) => {
            input.signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        input.signal.throwIfAborted();
        throw new Error("Generated-image operation deadline did not abort the dependency.");
      },
    },
  );
  assert.deepEqual(
    {
      code: JSON.parse(deadlineResult.output).code,
      stopReason: deadlineResult.stopReason,
      succeeded: deadlineResult.succeeded,
    },
    {
      code: "deadline_reached",
      stopReason: "deadline_reached",
      succeeded: false,
    },
  );
});

test("generated image tool propagates database and inactive-claim boundaries unchanged", async () => {
  const boundaryErrors = [
    new DatabaseCommitOutcomeUnknownError(
      new Error("Connection was lost while committing the image promotion job."),
    ),
    new TransientDatabaseHttpError(
      new Error("Database connection was unavailable."),
    ),
    new DatabaseTransactionRolledBackError(
      new Error("Database rolled back the generated-image transaction."),
    ),
    new InactiveChatRunClaimError(runId),
    new GeneratedCardImageProviderOutcomeUnknownError(
      runId,
      context.operationKey,
    ),
    new GeneratedCardImageStagingOutcomeUnknownError(
      runId,
      context.operationKey,
      new GeneratedMediaPromotionStorageTransientError(503),
    ),
  ];

  for (const boundaryError of boundaryErrors) {
    await assert.rejects(
      executeImage(validArguments, context, {
        generateCardImage: async () => {
          throw boundaryError;
        },
      }),
      (error: unknown) => error === boundaryError,
    );
  }
});

test("authoritative generated-image boundaries win when cancellation races", async () => {
  const stagingCause = new GeneratedMediaPromotionStorageTransientError(503);
  const stagingOutcomeError = new GeneratedCardImageStagingOutcomeUnknownError(
    runId,
    context.operationKey,
    stagingCause,
  );
  assert.equal(stagingOutcomeError.cause, stagingCause);
  assert.match(stagingOutcomeError.message, new RegExp(`runId=${runId}`, "u"));
  assert.match(
    stagingOutcomeError.message,
    new RegExp(`operationKey=${context.operationKey}`, "u"),
  );

  for (const authoritativeError of [
    new DatabaseCommitOutcomeUnknownError(
      new Error("Connection was lost while committing the image promotion job."),
    ),
    new InactiveChatRunClaimError(runId),
    new GeneratedCardImageProviderOutcomeUnknownError(
      runId,
      context.operationKey,
    ),
    stagingOutcomeError,
  ]) {
    const controller = new AbortController();
    await assert.rejects(
      executeImage(
        validArguments,
        { ...context, signal: controller.signal },
        {
          generateCardImage: async () => {
            controller.abort();
            throw authoritativeError;
          },
        },
      ),
      (error: unknown) => error === authoritativeError,
    );
  }
});

test("caller cancellation replaces a secondary non-abort-aware dependency error", async () => {
  for (const secondaryError of [
    new Error("Replica lookup completed after cancellation."),
    new TransientDatabaseHttpError(
      new Error("Database connection failed after cancellation."),
    ),
  ]) {
    const controller = new AbortController();
    await assert.rejects(
      executeImage(
        validArguments,
        { ...context, signal: controller.signal },
        {
          generateCardImage: async () => {
            controller.abort();
            throw secondaryError;
          },
        },
      ),
      (error: unknown) =>
        error instanceof DOMException
        && error.name === "AbortError"
        && error !== secondaryError,
    );
  }
});

test("generated image tool maps expected failures and rethrows unexpected failures", async () => {
  const expectedStorageFailure = await executeImage(validArguments, context, {
    generateCardImage: async () => {
      throw new GeneratedMediaPromotionStorageTransientError(503);
    },
  });
  assert.deepEqual(
    {
      code: JSON.parse(expectedStorageFailure.output).code,
      retryable: JSON.parse(expectedStorageFailure.output).retryable,
      succeeded: expectedStorageFailure.succeeded,
    },
    {
      code: "MEDIA_ASSET_STORAGE_UNAVAILABLE",
      retryable: true,
      succeeded: false,
    },
  );

  const provider = new OpenAIGeneratedCardImageProvider(new OpenAI({
    apiKey: "test-openai-api-key",
    maxRetries: 0,
    fetch: async () => new Response(
      JSON.stringify({
        error: {
          message: "The image request was rejected.",
          type: "invalid_request_error",
          code: "invalid_prompt",
          param: "prompt",
        },
      }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_expected_provider_failure",
        },
      },
    ),
  }));
  const expectedProviderFailure = await executeImage(validArguments, context, {
    generateCardImage: async (input) => {
      await provider.generate({
        userId: input.userId,
        imagePrompt: input.imagePrompt,
        observationContext: input.observationContext,
        signal: input.signal,
        operationDeadlineMs: input.operationDeadlineMs,
      });
      throw new Error("Expected the OpenAI provider call to fail.");
    },
  });
  assert.deepEqual(
    {
      code: JSON.parse(expectedProviderFailure.output).code,
      retryable: JSON.parse(expectedProviderFailure.output).retryable,
      succeeded: expectedProviderFailure.succeeded,
    },
    {
      code: "provider_failed",
      retryable: false,
      succeeded: false,
    },
  );

  class DerivedStorageTransientError extends GeneratedMediaPromotionStorageTransientError {}
  const storageLookalike = Object.assign(
    new Error("Generated media storage lookalike."),
    { code: "S3_TRANSIENT" },
  );
  const unexpectedErrors = [
    new DerivedStorageTransientError(503),
    storageLookalike,
    new GeneratedMediaPromotionStorageTerminalError(
      "S3_ACCESS_DENIED",
      "Generated image storage access was denied.",
      403,
    ),
    new HttpError(
      503,
      "A generic HTTP error must not be treated as a managed-storage domain failure.",
      "MEDIA_ASSET_STORAGE_UNAVAILABLE",
    ),
    new Error("Generated image staging returned an invalid storage payload."),
  ];
  for (const unexpectedError of unexpectedErrors) {
    await assert.rejects(
      executeImage(validArguments, context, {
        generateCardImage: async () => {
          throw unexpectedError;
        },
      }),
      (error: unknown) => error === unexpectedError,
    );
  }

  const invalidResponseProvider = new OpenAIGeneratedCardImageProvider(new OpenAI({
    apiKey: "test-openai-api-key",
    maxRetries: 0,
    fetch: async () => new Response(
      JSON.stringify({ created: 1_721_000_000, data: [] }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_invalid_provider_response",
        },
      },
    ),
  }));
  await assert.rejects(
    executeImage(validArguments, context, {
      generateCardImage: async (input) => {
        await invalidResponseProvider.generate({
          userId: input.userId,
          imagePrompt: input.imagePrompt,
          observationContext: input.observationContext,
          signal: input.signal,
          operationDeadlineMs: input.operationDeadlineMs,
        });
        throw new Error("Expected the invalid provider response to fail.");
      },
    }),
    (error: unknown) =>
      error instanceof OpenAIImageGenerationResponseError
      && error.requestID === "req_invalid_provider_response",
  );
});
