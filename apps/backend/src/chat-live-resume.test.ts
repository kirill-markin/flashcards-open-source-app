import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { runLiveStreamWithDependencies } from "./chat/live";
import type { PersistedChatMessageItem } from "./chat/store";
import type { ContentPart } from "./chat/types";

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
      userId: "user-1",
      workspaceId: "workspace-1",
      afterCursor: 5,
      requestId: "request-1",
    }, {
      listChatMessagesAfterCursor: async () => [
        makeAssistantMessage({
          itemId: "assistant-1",
          itemOrder: 6,
          state: "completed",
          content: [{ type: "text", text: "done" }],
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
      type: "assistant_message_done",
      cursor: "6",
      itemId: "assistant-1",
      content: [{ type: "text", text: "done" }],
      isError: false,
      isStopped: false,
    },
    {
      type: "run_state",
      runState: "idle",
      sessionId: "session-1",
    },
  ]);
});

test("resume replay seeds in-progress assistant content and continues live deltas for the same item", async () => {
  const output = await collectStreamOutput(async (stream) => {
    await runLiveStreamWithDependencies(stream, {
      sessionId: "session-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      afterCursor: 5,
      requestId: "request-2",
    }, {
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
      text: "hello",
      cursor: "6",
      itemId: "assistant-2",
    },
    {
      type: "assistant_delta",
      text: " world",
      cursor: "6",
      itemId: "assistant-2",
    },
    {
      type: "run_state",
      runState: "running",
      sessionId: "session-1",
    },
  ]);
});

test("resume replay emits reset_required when backlog contains multiple in-progress assistant items", async () => {
  const output = await collectStreamOutput(async (stream) => {
    await runLiveStreamWithDependencies(stream, {
      sessionId: "session-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      afterCursor: 5,
      requestId: "request-3",
    }, {
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
      type: "reset_required",
    },
  ]);
});
