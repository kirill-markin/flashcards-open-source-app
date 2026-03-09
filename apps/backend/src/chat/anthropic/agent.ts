import Anthropic, { toFile } from "@anthropic-ai/sdk";
import type {
  ChatMessage,
  ChatStreamEvent,
  ContentPart,
  FileContentPart,
  ImageContentPart,
  TextContentPart,
} from "../types";
import {
  buildSystemInstructions,
  extractText,
  summarizeContent,
} from "../shared";
import { ANTHROPIC_FLASHCARDS_TOOLS, CODE_EXECUTION_TOOL, executeTool } from "./tools";

type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;

const MAX_TOKENS = 8192;
const MAX_TURNS = 10;
const FILES_BETA = "files-api-2025-04-14" as const;

const CODE_EXECUTION_RESULT_TYPES = new Set([
  "code_execution_tool_result",
  "bash_code_execution_tool_result",
  "text_editor_code_execution_tool_result",
]);

const isUploadableFile = (part: ContentPart): part is FileContentPart =>
  part.type === "file" && part.mediaType !== "application/pdf";

async function uploadFiles(
  client: Anthropic,
  messages: ReadonlyArray<ChatMessage>,
): Promise<Map<string, string>> {
  const fileIds = new Map<string, string>();
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");

  if (lastUserMessage === undefined) {
    return fileIds;
  }

  const uploadParts = lastUserMessage.content.filter(isUploadableFile);
  for (const part of uploadParts) {
    const buffer = Buffer.from(part.base64Data, "base64");
    const file = await toFile(buffer, part.fileName, { type: part.mediaType });
    const metadata = await client.beta.files.upload({
      file,
      betas: [FILES_BETA],
    });
    fileIds.set(part.fileName, metadata.id);
  }

  return fileIds;
}

function mapUserPart(
  part: TextContentPart | ImageContentPart | FileContentPart,
  fileIds: Map<string, string>,
): BetaContentBlockParam {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: part.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: part.base64Data,
        },
      };
    case "file": {
      if (part.mediaType === "application/pdf") {
        return {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: part.base64Data,
          },
          title: part.fileName,
        };
      }

      const fileId = fileIds.get(part.fileName);
      if (fileId !== undefined) {
        return { type: "container_upload", file_id: fileId };
      }

      return {
        type: "document",
        source: {
          type: "text",
          media_type: "text/plain",
          data: Buffer.from(part.base64Data, "base64").toString("utf-8"),
        },
        title: part.fileName,
      };
    }
  }
}

function buildMessages(
  messages: ReadonlyArray<ChatMessage>,
  fileIds: Map<string, string>,
): Array<BetaMessageParam> {
  let lastUserIdx = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") {
      lastUserIdx = index;
      break;
    }
  }

  const result: Array<BetaMessageParam> = [];

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];

    if (message.role === "assistant") {
      result.push({
        role: "assistant",
        content: [{ type: "text", text: extractText(message.content) }],
      });
      continue;
    }

    const hasAttachments = message.content.some((part) => part.type !== "text");

    if (!hasAttachments) {
      result.push({ role: "user", content: extractText(message.content) });
      continue;
    }

    if (index === lastUserIdx) {
      result.push({
        role: "user",
        content: message.content
          .filter((part): part is TextContentPart | ImageContentPart | FileContentPart => part.type !== "tool_call")
          .map((part) => mapUserPart(part, fileIds)),
      });
      continue;
    }

    result.push({ role: "user", content: summarizeContent(message.content) });
  }

  return result;
}

function blockToParam(block: BetaContentBlock): BetaContentBlockParam {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }

  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input,
    };
  }

  if (block.type === "server_tool_use") {
    return {
      type: "server_tool_use",
      id: block.id,
      name: block.name,
      input: block.input,
    };
  }

  if (block.type === "web_search_tool_result") {
    return block as unknown as BetaContentBlockParam;
  }

  if (CODE_EXECUTION_RESULT_TYPES.has(block.type)) {
    return block as unknown as BetaContentBlockParam;
  }

  return { type: "text", text: "" };
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
  const client = new Anthropic();
  const fileIds = await uploadFiles(client, params.messages);
  const messages = buildMessages(params.messages, fileIds);
  let containerId: string | undefined;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = client.beta.messages.stream({
      model: params.model,
      max_tokens: MAX_TOKENS,
      system: buildSystemInstructions(params.timezone),
      messages,
      tools: [
        ...ANTHROPIC_FLASHCARDS_TOOLS,
        CODE_EXECUTION_TOOL,
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
        },
      ],
      betas: [FILES_BETA],
      container: containerId,
    });

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          yield { type: "tool_call", name: event.content_block.name, status: "started" };
        }

        if (event.content_block.type === "server_tool_use") {
          yield { type: "tool_call", name: event.content_block.name, status: "started" };
        }

        if (event.content_block.type === "web_search_tool_result") {
          yield { type: "tool_call", name: "web_search", status: "completed" };
        }
      }

      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "delta", text: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    containerId = finalMessage.container?.id ?? containerId;

    messages.push({
      role: "assistant",
      content: finalMessage.content.map(blockToParam),
    });

    for (const block of finalMessage.content) {
      if (CODE_EXECUTION_RESULT_TYPES.has(block.type)) {
        yield { type: "tool_call", name: "code_execution", status: "completed" };
      }
    }

    if (finalMessage.stop_reason !== "tool_use") {
      yield { type: "done" };
      return;
    }

    const toolResults: Array<Anthropic.Beta.Messages.BetaToolResultBlockParam> = [];
    for (const block of finalMessage.content) {
      if (block.type !== "tool_use") {
        continue;
      }

      const result = await executeTool(
        block.id,
        block.name,
        block.input,
        params.workspaceId,
        params.deviceId,
      );
      toolResults.push(result);
      const toolOutput = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
      yield {
        type: "tool_call",
        name: block.name,
        status: "completed",
        input: JSON.stringify(block.input),
        output: toolOutput,
      };
    }

    messages.push({ role: "user", content: toolResults });
  }

  yield { type: "done" };
}
