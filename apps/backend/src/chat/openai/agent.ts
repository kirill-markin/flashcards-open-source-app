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
  getLatestUserText,
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

export type StreamAgentParams = Readonly<{
  messages: ReadonlyArray<ChatMessage>;
  model: string;
  workspaceId: string;
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
      latestUserText: getLatestUserText(params.messages),
    },
    maxTurns: 10,
  });

  let activeToolName: string | null = null;
  let activeToolInput: string | null = null;
  let emittedAssistantText = "";

  for await (const event of result) {
    if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") {
      emittedAssistantText += event.data.delta;
      yield { type: "delta", text: event.data.delta };
      continue;
    }

    if (event.type !== "run_item_stream_event") {
      continue;
    }

    if (event.name === "message_output_created" && event.item.type === "message_output_item") {
      const remainingText = event.item.content.startsWith(emittedAssistantText)
        ? event.item.content.slice(emittedAssistantText.length)
        : event.item.content;

      if (remainingText !== "") {
        emittedAssistantText += remainingText;
        yield { type: "delta", text: remainingText };
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
      yield { type: "tool_call", name: activeToolName, status: "started" };
      continue;
    }

    if (event.name === "tool_output" && event.item.type === "tool_call_output_item") {
      const toolName = activeToolName ?? "tool";
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

  yield { type: "done" };
}
