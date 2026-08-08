import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS, startOpenAILoopWithDeps } from "./loop";
import { buildOpenAISafetyIdentifier } from "../safetyIdentifier";
import { createBackendObservationScope } from "../../../observability/sentry";
import {
  DatabaseCommitOutcomeUnknownError,
  TransientDatabaseHttpError,
} from "../../../database/transient";
import {
  generateCardImageWithDependencies,
  type GeneratedCardImageOperationDependencies,
  type PreparedGeneratedCardImage,
} from "../../cardImages/operation";
import {
  OpenAIImageGenerationResponseError,
} from "../../cardImages/provider/openaiAdapter";
import {
  GeneratedCardImageProviderOutcomeUnknownError,
  GeneratedCardImageStagingOutcomeUnknownError,
} from "../../cardImages/providerTypes";
import {
  GeneratedMediaPromotionStorageTransientError,
} from "../../../mediaAssets/storage";
import {
  collectEvents,
  createAbortedResponseStream,
  createAssistantMessageItem,
  createDependencies,
  createFunctionCallAddedEvent,
  createFunctionCallItem,
  createIndexedFunctionCallItem,
  createParams,
  createResponse,
  createResponseStream,
  createSdkAbortedResponseStream,
} from "./loop.testSupport";

function createNamedFunctionCallItem(
  index: number,
  name: "add_generated_image_to_card" | "sql",
): OpenAI.Responses.ResponseFunctionToolCall {
  return {
    type: "function_call",
    id: `tool-item-${String(index)}`,
    call_id: `call-${String(index)}`,
    name,
    arguments: name === "sql"
      ? `{"sql":"select ${String(index)}"}`
      : "{}",
    status: "completed",
  } as OpenAI.Responses.ResponseFunctionToolCall;
}

test("startOpenAILoopWithDeps stops before the next tool call when requested", async () => {
  let stopBeforeNextStep = false;
  let streamCallCount = 0;
  let toolCallCount = 0;
  const startedFunctionCallItem = createFunctionCallItem("in_progress");
  const completedFunctionCallItem = createFunctionCallItem("completed");

  const result = await startOpenAILoopWithDeps(
    createParams({
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      () => {
        streamCallCount += 1;
        stopBeforeNextStep = true;
        return createResponseStream(
          [createFunctionCallAddedEvent(startedFunctionCallItem)],
          createResponse([
            completedFunctionCallItem,
            createIndexedFunctionCallItem(2, "completed"),
          ], ""),
        );
      },
      async () => {
        toolCallCount += 1;
        return {
          output: "{\"ok\":true}",
          isMutating: false,
          succeeded: true,
        };
      },
    ),
  );

  assert.equal(streamCallCount, 1);
  assert.equal(toolCallCount, 0);
  assert.equal(result.terminationReason, "stopped_before_next_step");
  assert.deepEqual(result.openaiItems, []);
});

test("startOpenAILoopWithDeps stops after a completed tool call before the next model call", async () => {
  let stopBeforeNextStep = false;
  let streamCallCount = 0;
  let toolCallCount = 0;
  let observedClaimToken: string | null = null;
  let observedOperationKey: string | null = null;
  let observedGeneratedImageEligible: boolean | null = null;
  let observedSignal: AbortSignal | null = null;
  const abortController = new AbortController();
  const startedFunctionCallItem = createFunctionCallItem("in_progress");
  const completedFunctionCallItem = createFunctionCallItem("completed");
  const { sink, events } = collectEvents();

  const result = await startOpenAILoopWithDeps(
    createParams({
      signal: abortController.signal,
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    sink,
    createDependencies(
      () => {
        streamCallCount += 1;
        return createResponseStream(
          [createFunctionCallAddedEvent(startedFunctionCallItem)],
          createResponse([completedFunctionCallItem], ""),
        );
      },
      async (params) => {
        toolCallCount += 1;
        observedClaimToken = params.claimToken;
        observedOperationKey = params.operationKey;
        observedGeneratedImageEligible = params.generatedImageEligible;
        observedSignal = params.signal;
        stopBeforeNextStep = true;
        return {
          output: "{\"ok\":false}",
          isMutating: false,
          succeeded: false,
          shouldInvalidateMainContent: true,
        };
      },
    ),
  );

  assert.equal(streamCallCount, 1);
  assert.equal(toolCallCount, 1);
  assert.equal(observedClaimToken, createParams({}).claimToken);
  assert.equal(observedOperationKey, "not-generated-image");
  assert.equal(observedGeneratedImageEligible, false);
  assert.equal(observedSignal, abortController.signal);
  assert.equal(result.terminationReason, "stopped_before_next_step");
  assert.deepEqual(result.openaiItems, [
    {
      type: "function_call",
      call_id: "call-1",
      name: "sql",
      arguments: "{\"sql\":\"select 1\"}",
      status: "completed",
    },
    {
      type: "function_call_output",
      call_id: "call-1",
      output: "{\"ok\":false}",
    },
  ]);
  assert.deepEqual(events, [
    {
      type: "tool_call",
      id: "call-1",
      itemId: "tool-item-1",
      name: "sql",
      status: "started",
      responseIndex: 0,
      outputIndex: 0,
      sequenceNumber: 1,
      providerStatus: "in_progress",
      input: "{\"sql\":\"select 1\"}",
    },
    {
      type: "tool_call",
      id: "call-1",
      itemId: "tool-item-1",
      name: "sql",
      status: "completed",
      responseIndex: 0,
      outputIndex: 0,
      sequenceNumber: 1,
      providerStatus: "completed",
      input: "{\"sql\":\"select 1\"}",
      output: "{\"ok\":false}",
      refreshRoute: true,
    },
  ]);
});

test("generated-image boundary failures stop the loop without advancing the ordinal", async () => {
  for (const boundaryError of [
    new DatabaseCommitOutcomeUnknownError(
      new Error("Connection was lost while committing the image promotion job."),
    ),
    new TransientDatabaseHttpError(
      new Error("Database connection was unavailable."),
    ),
    new GeneratedCardImageProviderOutcomeUnknownError(
      "11111111-1111-4111-8111-111111111111",
      "generated-image:1",
    ),
    new GeneratedCardImageStagingOutcomeUnknownError(
      "11111111-1111-4111-8111-111111111111",
      "generated-image:1",
      new GeneratedMediaPromotionStorageTransientError(503),
    ),
    new OpenAIImageGenerationResponseError(
      "OpenAI image generation returned an invalid image response.",
      200,
      "req_invalid_response",
      new Error("Missing image bytes."),
    ),
    new Error("Generated image staging returned an invalid storage payload."),
  ]) {
    const functionCall = createNamedFunctionCallItem(
      1,
      "add_generated_image_to_card",
    );
    const observedOperationKeys: Array<string> = [];
    let modelCallCount = 0;

    await assert.rejects(
      startOpenAILoopWithDeps(
        createParams({ generatedImageEligible: true }),
        async (): Promise<void> => undefined,
        createDependencies(
          () => {
            modelCallCount += 1;
            return createResponseStream(
              [createFunctionCallAddedEvent(functionCall)],
              createResponse([functionCall], ""),
            );
          },
          async (params) => {
            observedOperationKeys.push(params.operationKey);
            throw boundaryError;
          },
        ),
      ),
      (error: unknown) => error === boundaryError,
    );
    assert.equal(modelCallCount, 1);
    assert.deepEqual(observedOperationKeys, ["generated-image:1"]);
  }
});

test("generated image reuse is stable when reclaim changes preceding SQL call count", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const workspaceId = "33333333-3333-4333-8333-333333333333";
  const cardId = "44444444-4444-4444-8444-444444444444";
  const replicaId = "55555555-5555-4555-8555-555555555555";
  const stagedByOperationId = new Map<string, PreparedGeneratedCardImage>();
  const enqueuedOperationIds = new Set<string>();
  const observedImageOperationKeys: Array<string> = [];
  const observedImageStatuses: Array<string> = [];
  let providerGenerationCount = 0;

  const operationDependencies: GeneratedCardImageOperationDependencies = {
    assertPreconditionsFn: async () => undefined,
    withOperationLockFn: async (_input, callback) =>
      callback(new AbortController().signal),
    prepareStagedImageFn: async (_input, metadata) => {
      const existing = stagedByOperationId.get(metadata.operationId);
      if (existing !== undefined) {
        return { ...existing, reused: true };
      }
      providerGenerationCount += 1;
      const staged: PreparedGeneratedCardImage = {
        stagingStorageKey: `media/uploads/${metadata.operationId}`,
        mimeType: "image/jpeg",
        sizeBytes: 10,
        sha256: "a".repeat(64),
        reused: false,
      };
      stagedByOperationId.set(metadata.operationId, staged);
      return staged;
    },
    enqueuePromotionJobFn: async (_input, metadata) => {
      const existing = enqueuedOperationIds.has(metadata.operationId);
      enqueuedOperationIds.add(metadata.operationId);
      return {
        outcome: existing ? "existing" : "created",
        jobId: metadata.operationId,
        placeholderApplied: true,
      };
    },
  };

  const runAttempt = async (
    precedingSqlCallCount: number,
    claimToken: string,
  ): Promise<void> => {
    let modelCallCount = 0;
    const functionCalls = [
      ...Array.from(
        { length: precedingSqlCallCount },
        (_value, index) => createNamedFunctionCallItem(index + 1, "sql"),
      ),
      createNamedFunctionCallItem(
        precedingSqlCallCount + 1,
        "add_generated_image_to_card",
      ),
    ];

    const completion = await startOpenAILoopWithDeps(
      createParams({
        runId,
        sessionId,
        workspaceId,
        claimToken,
        generatedImageEligible: true,
      }),
      async (): Promise<void> => undefined,
      createDependencies(
        () => {
          modelCallCount += 1;
          return modelCallCount === 1
            ? createResponseStream(
              functionCalls.map(createFunctionCallAddedEvent),
              createResponse(functionCalls, ""),
            )
            : createResponseStream(
              [],
              createResponse([createAssistantMessageItem("done")], "done"),
            );
        },
        async (params) => {
          if (params.item.name === "sql") {
            return {
              output: "{\"ok\":true}",
              isMutating: false,
              succeeded: true,
            };
          }
          observedImageOperationKeys.push(params.operationKey);
          const result = await generateCardImageWithDependencies(
            {
              runId,
              sessionId,
              claimToken,
              userId: params.userId,
              workspaceId,
              cardId,
              targetSide: "back",
              imagePrompt: "Draw a labeled plant cell.",
              altText: "Plant cell diagram",
              replicaId,
              operationKey: params.operationKey,
              observationContext: {
                scope: createBackendObservationScope(
                  "chat-worker",
                  null,
                  null,
                  null,
                  params.userId,
                  workspaceId,
                  params.requestId,
                  runId,
                  sessionId,
                  null,
                  null,
                ),
                rootObservation: null,
              },
              signal: params.signal ?? new AbortController().signal,
              operationDeadlineMs: params.generatedImageOperationDeadlineMs,
            },
            operationDependencies,
          );
          observedImageStatuses.push(result.status);
          return {
            output: JSON.stringify({ ok: true, status: result.status }),
            isMutating: result.status === "queued",
            succeeded: true,
          };
        },
      ),
    );
    assert.equal(completion.terminationReason, "completed");
  };

  await runAttempt(1, "2026-07-24 10:11:12.123456+00");
  await runAttempt(2, "2026-07-24 10:12:12.123456+00");

  assert.deepEqual(observedImageOperationKeys, [
    "generated-image:1",
    "generated-image:1",
  ]);
  assert.deepEqual(observedImageStatuses, ["queued", "already_queued"]);
  assert.equal(providerGenerationCount, 1);
});

test("startOpenAILoopWithDeps preserves replay items when a deadline aborts before a next model final response", async () => {
  let stopBeforeNextStep = false;
  let streamCallCount = 0;
  let toolCallCount = 0;
  const abortController = new AbortController();
  const startedFunctionCallItem = createFunctionCallItem("in_progress");
  const completedFunctionCallItem = createFunctionCallItem("completed");

  const result = await startOpenAILoopWithDeps(
    createParams({
      signal: abortController.signal,
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      () => {
        streamCallCount += 1;
        if (streamCallCount === 1) {
          return createResponseStream(
            [createFunctionCallAddedEvent(startedFunctionCallItem)],
            createResponse([completedFunctionCallItem], ""),
          );
        }

        stopBeforeNextStep = true;
        return createAbortedResponseStream(abortController);
      },
      async () => {
        toolCallCount += 1;
        return {
          output: "{\"ok\":true}",
          isMutating: false,
          succeeded: true,
        };
      },
    ),
  );

  assert.equal(streamCallCount, 2);
  assert.equal(toolCallCount, 1);
  assert.equal(result.terminationReason, "stopped_before_next_step");
  assert.deepEqual(result.openaiItems, [
    {
      type: "function_call",
      call_id: "call-1",
      name: "sql",
      arguments: "{\"sql\":\"select 1\"}",
      status: "completed",
    },
    {
      type: "function_call_output",
      call_id: "call-1",
      output: "{\"ok\":true}",
    },
  ]);
});

test("startOpenAILoopWithDeps preserves replay items when a deadline aborts a next SDK model final response", async () => {
  let stopBeforeNextStep = false;
  let streamCallCount = 0;
  let toolCallCount = 0;
  const abortController = new AbortController();
  const startedFunctionCallItem = createFunctionCallItem("in_progress");
  const completedFunctionCallItem = createFunctionCallItem("completed");

  const result = await startOpenAILoopWithDeps(
    createParams({
      signal: abortController.signal,
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      () => {
        streamCallCount += 1;
        if (streamCallCount === 1) {
          return createResponseStream(
            [createFunctionCallAddedEvent(startedFunctionCallItem)],
            createResponse([completedFunctionCallItem], ""),
          );
        }

        stopBeforeNextStep = true;
        return createSdkAbortedResponseStream(abortController);
      },
      async () => {
        toolCallCount += 1;
        return {
          output: "{\"ok\":true}",
          isMutating: false,
          succeeded: true,
        };
      },
    ),
  );

  assert.equal(streamCallCount, 2);
  assert.equal(toolCallCount, 1);
  assert.equal(result.terminationReason, "stopped_before_next_step");
  assert.deepEqual(result.openaiItems, [
    {
      type: "function_call",
      call_id: "call-1",
      name: "sql",
      arguments: "{\"sql\":\"select 1\"}",
      status: "completed",
    },
    {
      type: "function_call_output",
      call_id: "call-1",
      output: "{\"ok\":true}",
    },
  ]);
});

test("startOpenAILoopWithDeps reports phase transitions for model and tool execution", async () => {
  let stopBeforeNextStep = false;
  const phases: Array<string> = [];
  const startedFunctionCallItem = createFunctionCallItem("in_progress");
  const completedFunctionCallItem = createFunctionCallItem("completed");

  await startOpenAILoopWithDeps(
    createParams({
      onExecutionPhaseChanged: (phase): void => {
        phases.push(phase);
      },
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      () => createResponseStream(
        [createFunctionCallAddedEvent(startedFunctionCallItem)],
        createResponse([completedFunctionCallItem], ""),
      ),
      async () => {
        stopBeforeNextStep = true;
        return {
          output: "{\"ok\":true}",
          isMutating: false,
          succeeded: true,
        };
      },
    ),
  );

  assert.deepEqual(phases, ["idle", "model", "idle", "tool", "idle", "idle"]);
});

test("startOpenAILoopWithDeps reports model phase transitions for the tool-limit summary call", async () => {
  let streamCallCount = 0;
  let toolCallCount = 0;
  const phases: Array<string> = [];
  const requests: Array<OpenAI.Responses.ResponseCreateParams> = [];

  const result = await startOpenAILoopWithDeps(
    createParams({
      onExecutionPhaseChanged: (phase): void => {
        phases.push(phase);
      },
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      (request) => {
        requests.push(request);
        streamCallCount += 1;
        if (streamCallCount <= CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS) {
          return createResponseStream(
            [createFunctionCallAddedEvent(createIndexedFunctionCallItem(streamCallCount, "in_progress"))],
            createResponse([createIndexedFunctionCallItem(streamCallCount, "completed")], ""),
          );
        }

        return createResponseStream(
          [],
          createResponse([createAssistantMessageItem("summary")], "summary"),
        );
      },
      async () => {
        toolCallCount += 1;
        return {
          output: `{"call":${String(toolCallCount)}}`,
          isMutating: false,
          succeeded: true,
        };
      },
    ),
  );

  assert.equal(result.terminationReason, "completed");
  assert.equal(streamCallCount, CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS + 1);
  assert.equal(toolCallCount, CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS);
  assert.deepEqual(
    requests.map((request) => request.safety_identifier),
    Array.from(
      { length: CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS + 1 },
      () => buildOpenAISafetyIdentifier("user-1"),
    ),
  );
  assert.equal(requests[1].safety_identifier, buildOpenAISafetyIdentifier("user-1"));
  assert.equal(requests[CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS].tools?.length, 0);
  assert.equal(
    phases.filter((phase) => phase === "model").length,
    CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS + 1,
  );
  assert.equal(
    phases.filter((phase) => phase === "tool").length,
    CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS,
  );
  assert.deepEqual(phases.slice(-3), ["model", "idle", "idle"]);
});

test("startOpenAILoopWithDeps preserves replay items when a deadline aborts the tool-limit summary call", async () => {
  let stopBeforeNextStep = false;
  let streamCallCount = 0;
  let toolCallCount = 0;
  const abortController = new AbortController();

  const result = await startOpenAILoopWithDeps(
    createParams({
      signal: abortController.signal,
      shouldStopBeforeNextStep: (): boolean => stopBeforeNextStep,
    }),
    async (): Promise<void> => undefined,
    createDependencies(
      () => {
        streamCallCount += 1;
        if (streamCallCount <= CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS) {
          return createResponseStream(
            [createFunctionCallAddedEvent(createIndexedFunctionCallItem(streamCallCount, "in_progress"))],
            createResponse([createIndexedFunctionCallItem(streamCallCount, "completed")], ""),
          );
        }

        stopBeforeNextStep = true;
        return createSdkAbortedResponseStream(abortController);
      },
      async () => {
        toolCallCount += 1;
        return {
          output: `{"call":${String(toolCallCount)}}`,
          isMutating: false,
          succeeded: true,
        };
      },
    ),
  );

  assert.equal(result.terminationReason, "stopped_before_next_step");
  assert.equal(streamCallCount, CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS + 1);
  assert.equal(toolCallCount, CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS);
  assert.equal(result.openaiItems.length, CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS * 2);
  assert.deepEqual(result.openaiItems[0], {
    type: "function_call",
    call_id: "call-1",
    name: "sql",
    arguments: "{\"sql\":\"select 1\"}",
    status: "completed",
  });
  assert.deepEqual(result.openaiItems[result.openaiItems.length - 1], {
    type: "function_call_output",
    call_id: `call-${String(CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS)}`,
    output: `{"call":${String(CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS)}}`,
  });
});
