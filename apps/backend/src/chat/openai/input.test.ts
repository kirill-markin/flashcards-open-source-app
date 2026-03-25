import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import type { ContentPart } from "../types";
import type {
  ServerChatMessage,
  StoredOpenAIReplayItem,
} from "./replayItems";
import { buildChatCompletionInput } from "./input";

type InputMessage = OpenAI.Responses.EasyInputMessage & Readonly<{
  content: OpenAI.Responses.ResponseInputMessageContentList;
}>;

function encodeText(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function isInputMessage(
  item: OpenAI.Responses.ResponseInputItem,
): item is InputMessage {
  return item.type === "message"
    && "content" in item
    && Array.isArray(item.content);
}

function isInputFilePart(
  part: OpenAI.Responses.ResponseInputMessageContentList[number],
): part is Extract<OpenAI.Responses.ResponseInputMessageContentList[number], { type: "input_file" }> {
  return part.type === "input_file";
}

test("buildChatCompletionInput preserves prior attached files on later turns", async () => {
  const localMessages: ReadonlyArray<ServerChatMessage> = [
    {
      role: "user",
      content: [
        {
          type: "file",
          mediaType: "text/plain",
          base64Data: encodeText("hello"),
          fileName: "notes.txt",
        },
        { type: "text", text: "Read this." },
      ],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "I checked the file." }],
    },
  ];

  const turnInput: ReadonlyArray<ContentPart> = [{ type: "text", text: "Continue." }];
  const input = await buildChatCompletionInput(localMessages, turnInput, "UTC");
  let previousUserMessage: InputMessage | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    if (index > 0 && item !== undefined && isInputMessage(item) && item.role === "user") {
      previousUserMessage = item;
      break;
    }
  }
  if (previousUserMessage === null) {
    throw new Error("Expected a previous user message");
  }
  assert.equal(
    previousUserMessage.content.some((part: OpenAI.Responses.ResponseInputMessageContentList[number]) =>
      isInputFilePart(part) && part.filename === "notes.txt"),
    true,
  );
});

test("buildChatCompletionInput replays persisted assistant OpenAI items verbatim", async () => {
  const assistantReplayItems: ReadonlyArray<StoredOpenAIReplayItem> = [
    {
      type: "reasoning",
      summary: [],
      encrypted_content: "enc_123",
    },
    {
      type: "message",
      role: "assistant",
      status: "completed",
      phase: "final_answer",
      content: [{
        type: "output_text",
        text: "Native assistant answer",
        annotations: [],
      }],
    },
  ];

  const localMessages: ReadonlyArray<ServerChatMessage> = [
    {
      role: "user",
      content: [{ type: "text", text: "First turn" }],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "Visible transcript text" }],
      openaiItems: assistantReplayItems,
    },
  ];

  const input = await buildChatCompletionInput(localMessages, [{ type: "text", text: "Next turn" }], "UTC");
  assert.deepEqual(input.slice(2, 4), assistantReplayItems);
});
