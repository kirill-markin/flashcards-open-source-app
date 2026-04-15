import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { runLiveStreamWithDependencies } from "../live";
import type { ChatComposerSuggestion } from "../composerSuggestions";
import type { ChatRunSnapshot } from "../runs";
import type { PersistedChatMessageItem } from "../store";
import type { ContentPart } from "../types";

function makeAssistantMessage(
  params: Readonly<{
    itemId: string;
    itemOrder: number;
    state: "in_progress" | "completed" | "error" | "cancelled";
    content: ReadonlyArray<ContentPart>;
  }>,
): PersistedChatMessageItem {
  return {
    itemId: params.itemId,
    sessionId: "session-1",
    itemOrder: params.itemOrder,
    role: "assistant",
    content: params.content,
    state: params.state,
    isError: params.state === "error",
    isStopped: params.state === "cancelled",
    timestamp: 1,
    updatedAt: 1,
  };
}

function createRunSnapshot(
  status: ChatRunSnapshot["status"],
  assistantItemId: string,
): ChatRunSnapshot {
  return {
    runId: "run-1",
    sessionId: "session-1",
    assistantItemId,
    status,
    startedAt: 1,
    finishedAt: status === "queued" || status === "running" ? null : 2,
    lastErrorMessage: null,
  };
}

function createRunningSessionSnapshot(
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion> = [],
) {
  return {
    sessionId: "session-1",
    runState: "running" as const,
    activeRunId: "run-1",
    updatedAt: 1,
    activeRunHeartbeatAt: 1,
    composerSuggestions,
    mainContentInvalidationVersion: 0,
    messages: [],
  };
}

function createIdleSessionSnapshot(
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>,
) {
  return {
    sessionId: "session-1",
    runState: "idle" as const,
    activeRunId: null,
    updatedAt: 1,
    activeRunHeartbeatAt: null,
    composerSuggestions,
    mainContentInvalidationVersion: 0,
    messages: [],
  };
}

function createInterruptedSessionSnapshot() {
  return {
    sessionId: "session-1",
    runState: "interrupted" as const,
    activeRunId: null,
    updatedAt: 1,
    activeRunHeartbeatAt: null,
    composerSuggestions: [],
    mainContentInvalidationVersion: 0,
    messages: [],
  };
}

async function collectStreamOutput(
  execute: (stream: PassThrough) => Promise<void>,
): Promise<string> {
  const stream = new PassThrough();
  stream.setEncoding("utf8");
  let output = "";
  stream.on("data", (chunk: string) => {
    output += chunk;
  });

  await execute(stream);
  if (stream.readableEnded === false) {
    await new Promise<void>((resolve) => {
      stream.on("end", () => resolve());
    });
  }

  return output;
}

function parseLiveEvents(output: string): ReadonlyArray<unknown> {
  return output
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block !== "" && block.startsWith(":") === false)
    .map((block) => {
      const dataLine = block
        .split("\n")
        .find((line) => line.startsWith("data: "));
      assert.notEqual(dataLine, undefined);
      return JSON.parse(dataLine!.slice(6));
    });
}

test("resume replay emits terminal assistant backlog after afterCursor", async () => {
  const output = await collectStreamOutput(async (stream) => {
    await runLiveStreamWithDependencies(stream, {
      sessionId: "session-1",
      runId: "run-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      afterCursor: 5,
      requestId: "request-1",
    }, {
      getChatRunSnapshot: async () => createRunSnapshot("completed", "assistant-1"),
      getRecoveredChatSessionSnapshot: async () => createRunningSessionSnapshot(),
      listChatMessagesAfterCursor: async (_userId, _workspaceId, _sessionId, afterCursor) =>
        afterCursor === 5
          ? [
            makeAssistantMessage({
              itemId: "assistant-1",
              itemOrder: 6,
              state: "completed",
              content: [{ type: "text", text: "done" }],
            }),
          ]
          : [],
      listChatMessagesLatest: async () => ({
        messages: [],
        oldestCursor: null,
        newestCursor: null,
        hasOlder: false,
      }),
      waitForNextPollInterval: async () => false,
    });
  });

  assert.deepEqual(parseLiveEvents(output), [
    {
      type: "assistant_delta",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: "6",
      sequenceNumber: 1,
      streamEpoch: "run-1",
      itemId: "assistant-1",
      text: "done",
    },
    {
      type: "assistant_message_done",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: "6",
      sequenceNumber: 2,
      streamEpoch: "run-1",
      itemId: "assistant-1",
      content: [{ type: "text", text: "done" }],
      isError: false,
      isStopped: false,
    },
    {
      type: "run_terminal",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: "6",
      sequenceNumber: 3,
      streamEpoch: "run-1",
      outcome: "completed",
      assistantItemId: "assistant-1",
    },
  ]);
});

test("completed live replay emits composer suggestions before the terminal event", async () => {
  const composerSuggestions = [
    {
      id: "assistant-1-1",
      text: "Make it shorter",
      source: "assistant_follow_up",
      assistantItemId: "assistant-1",
    },
    {
      id: "assistant-1-2",
      text: "Give me one example",
      source: "assistant_follow_up",
      assistantItemId: "assistant-1",
    },
  ] as const;

  const output = await collectStreamOutput(async (stream) => {
    await runLiveStreamWithDependencies(stream, {
      sessionId: "session-1",
      runId: "run-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      afterCursor: undefined,
      requestId: "request-1b",
    }, {
      getChatRunSnapshot: async () => createRunSnapshot("completed", "assistant-1"),
      getRecoveredChatSessionSnapshot: async () => createRunningSessionSnapshot(composerSuggestions),
      listChatMessagesAfterCursor: async () => [],
      listChatMessagesLatest: async () => ({
        messages: [
          makeAssistantMessage({
            itemId: "assistant-1",
            itemOrder: 6,
            state: "completed",
            content: [{ type: "text", text: "done" }],
          }),
        ],
        oldestCursor: "6",
        newestCursor: "6",
        hasOlder: false,
      }),
      waitForNextPollInterval: async () => false,
    });
  });

  assert.deepEqual(parseLiveEvents(output), [
    {
      type: "composer_suggestions_updated",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: null,
      sequenceNumber: 1,
      streamEpoch: "run-1",
      suggestions: composerSuggestions,
    },
    {
      type: "run_terminal",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: null,
      sequenceNumber: 2,
      streamEpoch: "run-1",
      outcome: "completed",
      assistantItemId: "assistant-1",
    },
  ]);
});

test("resume replay seeds in-progress assistant content and continues live deltas for the same item", async () => {
  const output = await collectStreamOutput(async (stream) => {
    await runLiveStreamWithDependencies(stream, {
      sessionId: "session-1",
      runId: "run-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      afterCursor: 5,
      requestId: "request-2",
    }, {
      getChatRunSnapshot: async () => createRunSnapshot("running", "assistant-2"),
      getRecoveredChatSessionSnapshot: async () => createRunningSessionSnapshot(),
      listChatMessagesAfterCursor: async (_userId, _workspaceId, _sessionId, afterCursor) => {
        if (afterCursor === 5) {
          return [
            makeAssistantMessage({
              itemId: "assistant-2",
              itemOrder: 6,
              state: "in_progress",
              content: [{ type: "text", text: "hello" }],
            }),
          ];
        }

        return [];
      },
      listChatMessagesLatest: async () => ({
        messages: [
          makeAssistantMessage({
            itemId: "assistant-2",
            itemOrder: 6,
            state: "in_progress",
            content: [{ type: "text", text: "hello world" }],
          }),
        ],
        oldestCursor: "6",
        newestCursor: "6",
        hasOlder: false,
      }),
      waitForNextPollInterval: async () => false,
    });
  });

  assert.deepEqual(parseLiveEvents(output), [
    {
      type: "assistant_delta",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      text: "hello",
      cursor: "6",
      sequenceNumber: 1,
      streamEpoch: "run-1",
      itemId: "assistant-2",
    },
    {
      type: "assistant_delta",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      text: " world",
      cursor: "6",
      sequenceNumber: 2,
      streamEpoch: "run-1",
      itemId: "assistant-2",
    },
  ]);
});

test("terminal replay emits assistant_message_done before run_terminal when the same item finishes in place", async () => {
  let runSnapshotReadCount = 0;

  const output = await collectStreamOutput(async (stream) => {
    await runLiveStreamWithDependencies(stream, {
      sessionId: "session-1",
      runId: "run-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      afterCursor: 5,
      requestId: "request-4",
    }, {
      getChatRunSnapshot: async () => {
        runSnapshotReadCount += 1;
        return runSnapshotReadCount === 1
          ? createRunSnapshot("running", "assistant-5")
          : createRunSnapshot("completed", "assistant-5");
      },
      getRecoveredChatSessionSnapshot: async () => createRunningSessionSnapshot(),
      listChatMessagesAfterCursor: async (_userId, _workspaceId, _sessionId, afterCursor) => {
        if (afterCursor === 5) {
          return [
            makeAssistantMessage({
              itemId: "assistant-5",
              itemOrder: 6,
              state: runSnapshotReadCount < 2 ? "in_progress" : "completed",
              content: [{ type: "text", text: runSnapshotReadCount < 2 ? "hello" : "hello world" }],
            }),
          ];
        }

        return [];
      },
      listChatMessagesLatest: async () => ({
        messages: [],
        oldestCursor: null,
        newestCursor: null,
        hasOlder: false,
      }),
      waitForNextPollInterval: async () => true,
    });
  });

  assert.deepEqual(parseLiveEvents(output), [
    {
      type: "assistant_delta",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      text: "hello",
      cursor: "6",
      sequenceNumber: 1,
      streamEpoch: "run-1",
      itemId: "assistant-5",
    },
    {
      type: "assistant_delta",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      text: " world",
      cursor: "6",
      sequenceNumber: 2,
      streamEpoch: "run-1",
      itemId: "assistant-5",
    },
    {
      type: "assistant_message_done",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: "6",
      sequenceNumber: 3,
      streamEpoch: "run-1",
      itemId: "assistant-5",
      content: [{ type: "text", text: "hello world" }],
      isError: false,
      isStopped: false,
    },
    {
      type: "run_terminal",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: "6",
      sequenceNumber: 4,
      streamEpoch: "run-1",
      outcome: "completed",
      assistantItemId: "assistant-5",
    },
  ]);
});

test("terminal replay falls back to reset_required when a completed run has only unfinished streamed content", async () => {
  let runSnapshotReadCount = 0;

  const output = await collectStreamOutput(async (stream) => {
    await runLiveStreamWithDependencies(stream, {
      sessionId: "session-1",
      runId: "run-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      afterCursor: 5,
      requestId: "request-5",
    }, {
      getChatRunSnapshot: async () => {
        runSnapshotReadCount += 1;
        return runSnapshotReadCount === 1
          ? createRunSnapshot("running", "assistant-6")
          : createRunSnapshot("completed", "assistant-6");
      },
      getRecoveredChatSessionSnapshot: async () => createRunningSessionSnapshot(),
      listChatMessagesAfterCursor: async (_userId, _workspaceId, _sessionId, afterCursor) => {
        if (afterCursor === 5) {
          return runSnapshotReadCount < 2
            ? [
              makeAssistantMessage({
                itemId: "assistant-6",
                itemOrder: 6,
                state: "in_progress",
                content: [{ type: "text", text: "partial" }],
              }),
            ]
            : [];
        }

        return [];
      },
      listChatMessagesLatest: async () => ({
        messages: [],
        oldestCursor: null,
        newestCursor: null,
        hasOlder: false,
      }),
      waitForNextPollInterval: async () => true,
    });
  });

  assert.deepEqual(parseLiveEvents(output), [
    {
      type: "assistant_delta",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      text: "partial",
      cursor: "6",
      sequenceNumber: 1,
      streamEpoch: "run-1",
      itemId: "assistant-6",
    },
    {
      type: "run_terminal",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: "5",
      sequenceNumber: 2,
      streamEpoch: "run-1",
      outcome: "reset_required",
      assistantItemId: "assistant-6",
    },
  ]);
});

test("resume replay emits reset_required when backlog contains multiple in-progress assistant items", async () => {
  const output = await collectStreamOutput(async (stream) => {
    await runLiveStreamWithDependencies(stream, {
      sessionId: "session-1",
      runId: "run-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      afterCursor: 5,
      requestId: "request-3",
    }, {
      getChatRunSnapshot: async () => createRunSnapshot("running", "assistant-3"),
      getRecoveredChatSessionSnapshot: async () => createRunningSessionSnapshot(),
      listChatMessagesAfterCursor: async () => [
        makeAssistantMessage({
          itemId: "assistant-3",
          itemOrder: 6,
          state: "in_progress",
          content: [{ type: "text", text: "a" }],
        }),
        makeAssistantMessage({
          itemId: "assistant-4",
          itemOrder: 7,
          state: "in_progress",
          content: [{ type: "text", text: "b" }],
        }),
      ],
      listChatMessagesLatest: async () => ({
        messages: [],
        oldestCursor: null,
        newestCursor: null,
        hasOlder: false,
      }),
      waitForNextPollInterval: async () => false,
    });
  });

  assert.deepEqual(parseLiveEvents(output), [
    {
      type: "run_terminal",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: "5",
      sequenceNumber: 1,
      streamEpoch: "run-1",
      outcome: "reset_required",
      assistantItemId: "assistant-3",
    },
  ]);
});

test("recovered session read emits terminal events when the attached run finalized before the next poll wait", async () => {
  let runSnapshotReadCount = 0;
  let waitCallCount = 0;

  const output = await collectStreamOutput(async (stream) => {
    await runLiveStreamWithDependencies(stream, {
      sessionId: "session-1",
      runId: "run-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      afterCursor: 5,
      requestId: "request-6",
    }, {
      getChatRunSnapshot: async () => {
        runSnapshotReadCount += 1;
        return runSnapshotReadCount === 1
          ? createRunSnapshot("running", "assistant-7")
          : createRunSnapshot("completed", "assistant-7");
      },
      getRecoveredChatSessionSnapshot: async () => createIdleSessionSnapshot([]),
      listChatMessagesAfterCursor: async (_userId, _workspaceId, _sessionId, afterCursor) => {
        if (afterCursor === 5) {
          return [
            makeAssistantMessage({
              itemId: "assistant-7",
              itemOrder: 6,
              state: "completed",
              content: [{ type: "text", text: "done after recovery" }],
            }),
          ];
        }

        return [];
      },
      listChatMessagesLatest: async () => ({
        messages: [],
        oldestCursor: null,
        newestCursor: null,
        hasOlder: false,
      }),
      waitForNextPollInterval: async () => {
        waitCallCount += 1;
        return true;
      },
    });
  });

  assert.equal(waitCallCount, 0);
  assert.deepEqual(parseLiveEvents(output), [
    {
      type: "assistant_delta",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      text: "done after recovery",
      cursor: "6",
      sequenceNumber: 1,
      streamEpoch: "run-1",
      itemId: "assistant-7",
    },
    {
      type: "assistant_message_done",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: "6",
      sequenceNumber: 2,
      streamEpoch: "run-1",
      itemId: "assistant-7",
      content: [{ type: "text", text: "done after recovery" }],
      isError: false,
      isStopped: false,
    },
    {
      type: "run_terminal",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: "6",
      sequenceNumber: 3,
      streamEpoch: "run-1",
      outcome: "completed",
      assistantItemId: "assistant-7",
    },
  ]);
});

test("recovered session read emits reset_required immediately when the attached run no longer converges as active", async () => {
  let waitCallCount = 0;

  const output = await collectStreamOutput(async (stream) => {
    await runLiveStreamWithDependencies(stream, {
      sessionId: "session-1",
      runId: "run-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      afterCursor: 5,
      requestId: "request-7",
    }, {
      getChatRunSnapshot: async () => createRunSnapshot("running", "assistant-8"),
      getRecoveredChatSessionSnapshot: async () => createInterruptedSessionSnapshot(),
      listChatMessagesAfterCursor: async () => [],
      listChatMessagesLatest: async () => ({
        messages: [],
        oldestCursor: null,
        newestCursor: null,
        hasOlder: false,
      }),
      waitForNextPollInterval: async () => {
        waitCallCount += 1;
        return true;
      },
    });
  });

  assert.equal(waitCallCount, 0);
  assert.deepEqual(parseLiveEvents(output), [
    {
      type: "run_terminal",
      sessionId: "session-1",
      conversationScopeId: "session-1",
      runId: "run-1",
      cursor: "5",
      sequenceNumber: 1,
      streamEpoch: "run-1",
      outcome: "reset_required",
      assistantItemId: "assistant-8",
    },
  ]);
});
