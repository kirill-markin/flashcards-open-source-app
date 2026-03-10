import { Agent, run } from "@openai/agents";
import { codeInterpreterTool, webSearchTool } from "@openai/agents-openai";
import type {
  ChatMessage,
  ChatStreamEvent,
  FileContentPart,
  ImageContentPart,
  TextContentPart,
} from "../types";
import {
  buildSystemInstructions,
  extractText,
  summarizeContent,
  type AgentContext,
} from "../shared";
import { OPENAI_FLASHCARDS_TOOLS } from "./tools";

type UserContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image: string }
  | { type: "input_file"; file: string; filename: string };

type AssistantContentPart = { type: "output_text"; text: string };

type InputMessage =
  | { role: "user"; content: string | ReadonlyArray<UserContentPart> }
  | { role: "assistant"; content: ReadonlyArray<AssistantContentPart> };

type MessageOutputContentPart =
  | { type: "output_text"; text: string }
  | { type: "refusal"; refusal: string }
  | { type: "audio"; audio: string | { id: string }; format?: string | null; transcript?: string | null }
  | { type: "image"; image: string };

type ChatLogEvent =
  | Readonly<{
    action: "request";
    requestId: string;
    model: string;
    messageCount: number;
    attachmentCount: number;
  }>
  | Readonly<{
    action: "message_output_created";
    requestId: string;
    messageId: string | null;
    messageTextLength: number;
    unsentTextLength: number;
    duplicate: boolean;
  }>
  | Readonly<{
    action: "tool_call";
    requestId: string;
    tool: string;
    status: "started" | "completed";
  }>
  | Readonly<{
    action: "response";
    requestId: string;
    durationMs: number;
    rawDeltaEventCount: number;
    rawDeltaTextLength: number;
    messageOutputEventCount: number;
    emittedTextLength: number;
    toolCallCount: number;
    empty: boolean;
  }>
  | Readonly<{
    action: "error";
    requestId: string;
    stage: "stream";
    errorName: string;
  }>;

function logChatEvent(event: ChatLogEvent): void {
  console.log(JSON.stringify({
    domain: "chat",
    vendor: "openai",
    ...event,
  }));
}

function buildOpenaiInstructions(timezone: string): string {
  return (
    buildSystemInstructions(timezone) +
    "\nUse the code interpreter for calculations, transforms, or attachment analysis when useful." +
    "\nUse web search when the user needs current information beyond the workspace data."
  );
}

function mapUserPart(part: TextContentPart | ImageContentPart | FileContentPart): UserContentPart {
  switch (part.type) {
    case "text":
      return { type: "input_text", text: part.text };
    case "image":
      return {
        type: "input_image",
        image: `data:${part.mediaType};base64,${part.base64Data}`,
      };
    case "file":
      return {
        type: "input_file",
        file: `data:${part.mediaType};base64,${part.base64Data}`,
        filename: part.fileName,
      };
  }
}

function buildInput(messages: ReadonlyArray<ChatMessage>): ReadonlyArray<InputMessage> {
  let lastUserIdx = -1;

  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") {
      lastUserIdx = index;
      break;
    }
  }

  const result: Array<InputMessage> = [];

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];

    if (message.role === "assistant") {
      result.push({
        role: "assistant",
        content: [{ type: "output_text", text: extractText(message.content) }],
      });
      continue;
    }

    const hasAttachments = message.content.some((part) => part.type !== "text");
    if (!hasAttachments) {
      if (message.content.length === 1 && message.content[0].type === "text") {
        result.push({ role: "user", content: message.content[0].text });
      } else {
        result.push({ role: "user", content: extractText(message.content) });
      }
      continue;
    }

    if (index === lastUserIdx) {
      result.push({
        role: "user",
        content: message.content
          .filter((part): part is TextContentPart | ImageContentPart | FileContentPart => part.type !== "tool_call")
          .map(mapUserPart),
      });
      continue;
    }

    result.push({ role: "user", content: summarizeContent(message.content) });
  }

  return result;
}

function extractMessageOutputText(
  item: { rawItem: { content: ReadonlyArray<MessageOutputContentPart> } },
): string {
  return item.rawItem.content.reduce(
    (text: string, part) => (part.type === "output_text" ? text + part.text : text),
    "",
  );
}

function getUnsentMessageOutputText(fullText: string, streamedText: string): string {
  if (streamedText.length === 0) {
    return fullText;
  }

  if (!fullText.startsWith(streamedText)) {
    throw new Error(
      `OpenAI message output does not match streamed text prefix: fullTextLength=${fullText.length} streamedTextLength=${streamedText.length}`,
    );
  }

  return fullText.slice(streamedText.length);
}

export type StreamedMessageTextState = Readonly<{
  currentMessageText: string;
  emittedTextLength: number;
}>;

export function appendStreamedMessageText(
  state: StreamedMessageTextState,
  delta: string,
): StreamedMessageTextState {
  return {
    currentMessageText: state.currentMessageText + delta,
    emittedTextLength: state.emittedTextLength + delta.length,
  };
}

export function completeStreamedMessageText(
  state: StreamedMessageTextState,
  fullText: string,
): Readonly<{
  state: StreamedMessageTextState;
  unsentText: string;
}> {
  const unsentText = getUnsentMessageOutputText(fullText, state.currentMessageText);

  return {
    state: {
      currentMessageText: "",
      emittedTextLength: state.emittedTextLength + unsentText.length,
    },
    unsentText,
  };
}

export type StreamAgentParams = Readonly<{
  messages: ReadonlyArray<ChatMessage>;
  model: string;
  requestId: string;
  workspaceId: string;
  deviceId: string;
  timezone: string;
}>;

export async function* streamAgentResponse(
  params: StreamAgentParams,
): AsyncGenerator<ChatStreamEvent> {
  const agent = new Agent<AgentContext>({
    name: "Flashcards Assistant",
    instructions: buildOpenaiInstructions(params.timezone),
    model: params.model,
    tools: [
      ...OPENAI_FLASHCARDS_TOOLS,
      codeInterpreterTool(),
      webSearchTool({ searchContextSize: "medium" }),
    ],
  });

  const input = buildInput(params.messages);
  const result = await run(agent, input as Parameters<typeof run>[1], {
    stream: true,
    context: {
      workspaceId: params.workspaceId,
      deviceId: params.deviceId,
    },
    maxTurns: 10,
  });

  let activeToolName: string | null = null;
  let activeToolInput: string | null = null;
  let streamedMessageTextState: StreamedMessageTextState = {
    currentMessageText: "",
    emittedTextLength: 0,
  };
  let rawDeltaEventCount = 0;
  let rawDeltaTextLength = 0;
  let messageOutputEventCount = 0;
  let toolCallCount = 0;
  const emittedMessageOutputIds = new Set<string>();
  const attachmentCount = params.messages.reduce(
    (count: number, message: ChatMessage) => count + message.content.filter((part) => part.type !== "text").length,
    0,
  );
  const requestStartedAt = Date.now();

  logChatEvent({
    action: "request",
    requestId: params.requestId,
    model: params.model,
    messageCount: params.messages.length,
    attachmentCount,
  });

  try {
    for await (const event of result) {
      if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") {
        rawDeltaEventCount += 1;
        rawDeltaTextLength += event.data.delta.length;
        streamedMessageTextState = appendStreamedMessageText(streamedMessageTextState, event.data.delta);
        yield { type: "delta", text: event.data.delta };
        continue;
      }

      if (event.type !== "run_item_stream_event") {
        continue;
      }

      if (event.name === "message_output_created" && event.item.type === "message_output_item") {
        const messageId = event.item.rawItem.id;
        const isDuplicate = messageId !== undefined && emittedMessageOutputIds.has(messageId);
        if (isDuplicate) {
          logChatEvent({
            action: "message_output_created",
            requestId: params.requestId,
            messageId: messageId ?? null,
            messageTextLength: 0,
            unsentTextLength: 0,
            duplicate: true,
          });
          continue;
        }

        const messageText = extractMessageOutputText(event.item);
        const completion = completeStreamedMessageText(streamedMessageTextState, messageText);
        const unsentText = completion.unsentText;
        streamedMessageTextState = completion.state;
        messageOutputEventCount += 1;

        logChatEvent({
          action: "message_output_created",
          requestId: params.requestId,
          messageId: messageId ?? null,
          messageTextLength: messageText.length,
          unsentTextLength: unsentText.length,
          duplicate: false,
        });

        if (unsentText !== "") {
          yield { type: "delta", text: unsentText };
        }

        if (messageId !== undefined) {
          emittedMessageOutputIds.add(messageId);
        }

        continue;
      }

      if (event.name === "tool_called" && event.item.type === "tool_call_item") {
        activeToolName = event.item.rawItem.type === "function_call"
          ? event.item.rawItem.name
          : event.item.rawItem.type;
        activeToolInput = event.item.rawItem.type === "function_call"
          ? (event.item.rawItem.arguments ?? null)
          : null;
        logChatEvent({
          action: "tool_call",
          requestId: params.requestId,
          tool: activeToolName,
          status: "started",
        });
        yield { type: "tool_call", name: activeToolName, status: "started" };
        continue;
      }

      if (event.name === "tool_output" && event.item.type === "tool_call_output_item") {
        const toolName = activeToolName ?? "tool";
        toolCallCount += 1;
        logChatEvent({
          action: "tool_call",
          requestId: params.requestId,
          tool: toolName,
          status: "completed",
        });
        const toolOutput = typeof event.item.output === "string"
          ? event.item.output
          : JSON.stringify(event.item.output);
        yield {
          type: "tool_call",
          name: toolName,
          status: "completed",
          input: activeToolInput ?? undefined,
          output: toolOutput,
        };
        activeToolName = null;
        activeToolInput = null;
      }
    }
  } catch (error) {
    logChatEvent({
      action: "error",
      requestId: params.requestId,
      stage: "stream",
      errorName: error instanceof Error ? error.name : "NonError",
    });
    throw error;
  }

  logChatEvent({
    action: "response",
    requestId: params.requestId,
    durationMs: Date.now() - requestStartedAt,
    rawDeltaEventCount,
    rawDeltaTextLength,
    messageOutputEventCount,
    emittedTextLength: streamedMessageTextState.emittedTextLength,
    toolCallCount,
    empty: streamedMessageTextState.emittedTextLength === 0,
  });

  yield { type: "done" };
}
