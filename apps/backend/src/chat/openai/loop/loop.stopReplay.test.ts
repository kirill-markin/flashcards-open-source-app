import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import { CHAT_RUN_MAX_TOOL_CALL_MODEL_CALLS, startOpenAILoopWithDeps } from "./loop";
import { buildOpenAISafetyIdentifier } from "../safetyIdentifier";
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
          createResponse([completedFunctionCallItem], ""),
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
  assert.deepEqual(result.openaiItems, [{
    type: "function_call",
    call_id: "call-1",
    name: "sql",
    arguments: "{\"sql\":\"select 1\"}",
    status: "completed",
  }]);
});

test("startOpenAILoopWithDeps stops after a completed tool call before the next model call", async () => {
  let stopBeforeNextStep = false;
  let streamCallCount = 0;
  let toolCallCount = 0;
  let observedClaimToken: string | null = null;
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
        observedSignal = params.signal;
        stopBeforeNextStep = true;
        return {
          output: "{\"ok\":true}",
          isMutating: true,
          succeeded: true,
        };
      },
    ),
  );

  assert.equal(streamCallCount, 1);
  assert.equal(toolCallCount, 1);
  assert.equal(observedClaimToken, createParams({}).claimToken);
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
      output: "{\"ok\":true}",
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
      output: "{\"ok\":true}",
      refreshRoute: true,
    },
  ]);
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
