/**
 * Builds OpenAI Responses input from backend-owned chat history and the current turn input.
 * The server reconstructs provider input from persisted messages instead of trusting client-owned transcripts.
 */
import type OpenAI from "openai";
import type { ContentPart, FileContentPart, ImageContentPart } from "../types";
import { buildSystemInstructions } from "../shared";
import {
  normalizeStoredOpenAIReplayItems,
  toOpenAIResponseInputItem,
  type ServerChatMessage,
} from "./replayItems";

type OpenAIInputItem = OpenAI.Responses.ResponseInputItem;
type OpenAIInputContent = OpenAI.Responses.ResponseInputMessageContentList[number];

function buildFileDataUrl(part: FileContentPart): string {
  return `data:${part.mediaType};base64,${part.base64Data}`;
}

async function mapAttachmentPart(
  part: ImageContentPart | FileContentPart,
): Promise<ReadonlyArray<OpenAIInputContent>> {
  if (part.type === "image") {
    return [{
      type: "input_image",
      detail: "auto",
      image_url: `data:${part.mediaType};base64,${part.base64Data}`,
    }];
  }

  return [{
    type: "input_file",
    filename: part.fileName,
    file_data: buildFileDataUrl(part),
  }];
}

function buildToolCallHistoryText(
  part: Extract<ContentPart, { type: "tool_call" }>,
): string {
  return [
    `Tool call: ${part.name}`,
    `Status: ${part.status}`,
    part.providerStatus === undefined || part.providerStatus === null
      ? null
      : `Provider status: ${part.providerStatus}`,
    part.input === null ? null : `Input:\n${part.input}`,
    part.output === null ? null : `Output:\n${part.output}`,
  ].filter((value): value is string => value !== null).join("\n");
}

function buildReasoningHistoryText(
  part: Extract<ContentPart, { type: "reasoning_summary" }>,
): string {
  return `Reasoning summary:\n${part.summary}`;
}

async function mapMessagePart(part: ContentPart): Promise<ReadonlyArray<OpenAIInputContent>> {
  if (part.type === "text") {
    return [{ type: "input_text", text: part.text }];
  }

  if (part.type === "image" || part.type === "file") {
    return mapAttachmentPart(part);
  }

  if (part.type === "tool_call") {
    return [{ type: "input_text", text: buildToolCallHistoryText(part) }];
  }

  return [{ type: "input_text", text: buildReasoningHistoryText(part) }];
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Removes the last user message from persisted history when it matches the current turn input exactly.
 * This prevents replaying the same turn twice when a run is prepared after the user item is already stored.
 */
function normalizeHistoryMessages(
  localMessages: ReadonlyArray<ServerChatMessage>,
  turnInput: ReadonlyArray<ContentPart>,
): ReadonlyArray<ServerChatMessage> {
  const lastMessage = localMessages.at(-1);
  if (lastMessage === undefined || lastMessage.role !== "user") {
    return localMessages;
  }

  if (stringifyJson(lastMessage.content) !== stringifyJson(turnInput)) {
    return localMessages;
  }

  return localMessages.slice(0, -1);
}

/**
 * Rebuilds provider replay items for assistant messages that were already persisted with OpenAI output.
 */
function buildAssistantHistoryItems(
  message: ServerChatMessage,
): ReadonlyArray<OpenAIInputItem> {
  if (message.openaiItems === undefined) {
    return [];
  }

  const { items } = normalizeStoredOpenAIReplayItems(message.openaiItems);
  return items.map(toOpenAIResponseInputItem);
}

async function buildUserInputMessage(
  content: ReadonlyArray<ContentPart>,
): Promise<OpenAIInputItem> {
  return {
    role: "user",
    type: "message",
    content: (await Promise.all(content.map(mapMessagePart))).flat(),
  };
}

/**
 * Builds the complete OpenAI Responses input array for one backend-owned chat run.
 */
export async function buildChatCompletionInput(
  localMessages: ReadonlyArray<ServerChatMessage>,
  turnInput: ReadonlyArray<ContentPart>,
  timezone: string,
): Promise<ReadonlyArray<OpenAIInputItem>> {
  const input: Array<OpenAIInputItem> = [{
    role: "system",
    type: "message",
    content: buildSystemInstructions(timezone),
  }];

  const normalizedHistory = normalizeHistoryMessages(localMessages, turnInput);
  for (const message of normalizedHistory) {
    if (message.role === "assistant") {
      input.push(...buildAssistantHistoryItems(message));
      continue;
    }

    if (message.content.length === 0) {
      continue;
    }

    input.push(await buildUserInputMessage(message.content));
  }

  input.push(await buildUserInputMessage(turnInput));
  return input;
}
