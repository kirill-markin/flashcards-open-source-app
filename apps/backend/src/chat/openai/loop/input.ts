/**
 * Builds OpenAI Responses input from backend-owned chat history and the current turn input.
 * The server reconstructs provider input from persisted messages instead of trusting client-owned transcripts.
 */
import type OpenAI from "openai";
import type { ContentPart, FileContentPart, ImageContentPart } from "../../types";
import { buildSystemInstructions } from "../../shared";
import { CHAT_HISTORY_REPLAY_TOKEN_BUDGET } from "../../config";
import { buildCardContextXml } from "../../cardContext";
import {
  validateChatFileAttachmentContent,
  validateChatImageAttachmentContent,
} from "../../attachmentPolicy";
import {
  normalizeStoredOpenAIReplayItems,
  toOpenAIResponseInputItem,
  type ServerChatMessage,
} from "../replayItems";

type OpenAIInputItem = OpenAI.Responses.ResponseInputItem;
type OpenAIInputContent = OpenAI.Responses.ResponseInputMessageContentList[number];

function buildImageDataUrl(part: ImageContentPart): string {
  const attachment = validateChatImageAttachmentContent(part.mediaType, part.base64Data);
  return `data:${attachment.mediaType};base64,${attachment.base64Data}`;
}

function buildFileDataUrl(part: FileContentPart): string {
  const attachment = validateChatFileAttachmentContent(part.fileName, part.mediaType, part.base64Data);
  return `data:${attachment.mediaType};base64,${attachment.base64Data}`;
}

async function mapAttachmentPart(
  part: ImageContentPart | FileContentPart,
): Promise<ReadonlyArray<OpenAIInputContent>> {
  if (part.type === "image") {
    return [{
      type: "input_image",
      detail: "auto",
      image_url: buildImageDataUrl(part),
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

  if (part.type === "card") {
    return [{ type: "input_text", text: buildCardContextXml(part) }];
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

const HISTORY_CHARS_PER_TOKEN = 4;
const HISTORY_ATTACHMENT_TOKEN_ESTIMATE = 1_500;

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / HISTORY_CHARS_PER_TOKEN);
}

function estimateContentPartTokens(part: ContentPart): number {
  if (part.type === "text") {
    return estimateTextTokens(part.text);
  }

  if (part.type === "image" || part.type === "file") {
    return HISTORY_ATTACHMENT_TOKEN_ESTIMATE;
  }

  if (part.type === "card") {
    return estimateTextTokens(`${part.frontText}${part.backText}${part.tags.join(" ")}`);
  }

  if (part.type === "tool_call") {
    return estimateTextTokens(`${part.name}${part.input ?? ""}${part.output ?? ""}`);
  }

  return estimateTextTokens(part.summary);
}

/**
 * Estimates the provider token cost of one persisted message, mirroring how
 * the input builder replays it: user messages cost their content, assistant
 * messages cost their stored OpenAI replay items.
 */
function estimateMessageTokens(message: ServerChatMessage): number {
  if (message.role === "assistant") {
    return message.openaiItems === undefined
      ? 0
      : estimateTextTokens(stringifyJson(message.openaiItems));
  }

  return message.content.reduce(
    (total, part) => total + estimateContentPartTokens(part),
    0,
  );
}

/**
 * Caps replayed history to a token budget by dropping the oldest messages.
 *
 * Only the provider input is windowed; full history stays in storage and in the
 * client UI. The kept window always starts at a user-message boundary so an
 * assistant turn's reasoning/tool-call replay items are never sent without the
 * originating user turn. Returns the input unchanged when it already fits.
 */
function windowHistoryToTokenBudget(
  history: ReadonlyArray<ServerChatMessage>,
  budgetTokens: number,
): ReadonlyArray<ServerChatMessage> {
  let runningTokens = 0;
  let keepFrom = history.length;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    runningTokens += estimateMessageTokens(history[index]);
    if (runningTokens > budgetTokens) {
      break;
    }
    keepFrom = index;
  }

  if (keepFrom === 0) {
    return history;
  }

  while (keepFrom < history.length && history[keepFrom].role !== "user") {
    keepFrom += 1;
  }

  return history.slice(keepFrom);
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
  const windowedHistory = windowHistoryToTokenBudget(normalizedHistory, CHAT_HISTORY_REPLAY_TOKEN_BUDGET);
  for (const message of windowedHistory) {
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
