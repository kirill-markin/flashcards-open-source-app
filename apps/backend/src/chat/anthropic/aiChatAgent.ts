import { Buffer } from "node:buffer";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import type {
  AIChatAssistantToolCall,
  AIChatMessage,
  AIChatProviderUsage,
  AIChatTurnStreamEvent,
  AIChatUserContext,
  AIChatWireMessage,
} from "../aiChatTypes";
import {
  buildAssistantToolCallContentParts,
  buildInlineTextAttachmentContext,
  buildAIChatSystemInstructions,
  extractAIChatAssistantToolCalls,
  isAIChatToolName,
  isRepairableToolCallError,
  makeAIChatRepairStatusEvent,
  MAX_AI_CHAT_TOOL_REPAIR_ATTEMPTS,
  summarizeAIChatContentParts,
  toAIChatAssistantToolCall,
} from "../aiChatRuntimeShared";
import { CHAT_MODELS } from "../models";
import { executeAIChatSqlTool } from "../aiChatToolExecutor";
import { OPENAI_AI_CHAT_TOOLS } from "../openai/aiChatTools";

const MAX_TOKENS = 8_192;
const FILES_BETA = "files-api-2025-04-14" as const;

const AI_CHAT_MODEL_IDS = new Set(
  CHAT_MODELS
    .filter((model) => model.vendor === "anthropic")
    .map((model) => model.id),
);

const CODE_EXECUTION_RESULT_TYPES = new Set([
  "code_execution_tool_result",
  "bash_code_execution_tool_result",
  "text_editor_code_execution_tool_result",
]);

type AnthropicTextDeltaEvent = Readonly<{
  type: "content_block_delta";
  delta: Readonly<{
    type: "text_delta";
    text: string;
  }>;
}>;

type AnthropicContentBlockStartEvent = Readonly<{
  type: "content_block_start";
  content_block: AnthropicContentBlock;
}>;

type AnthropicAIChatStreamEvent =
  | AnthropicTextDeltaEvent
  | AnthropicContentBlockStartEvent
  | Readonly<{ type: string }>;

type AnthropicFileUploadClient = Readonly<{
  upload: (
    body: Readonly<{ file: File; betas: Array<typeof FILES_BETA> }>,
  ) => Promise<Readonly<{ id: string }>>;
}>;

type AnthropicTextBlock = Readonly<{
  type: "text";
  text: string;
}>;

type AnthropicToolUseBlock = Readonly<{
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}>;

type AnthropicServerToolUseBlock = Readonly<{
  type: "server_tool_use";
  id: string;
  name: string;
  input: unknown;
}>;

type AnthropicWebSearchResult = Readonly<{
  type: "web_search_result";
  title: string;
  url: string;
}>;

type AnthropicWebSearchToolResultError = Readonly<{
  type: "web_search_tool_result_error";
  error_code: string;
}>;

type AnthropicWebSearchToolResultBlock = Readonly<{
  type: "web_search_tool_result";
  tool_use_id: string;
  content: ReadonlyArray<AnthropicWebSearchResult> | AnthropicWebSearchToolResultError;
}>;

type AnthropicCodeExecutionResultBlock = Readonly<{
  stdout?: string;
  stderr?: string;
  return_code?: number;
}>;

type AnthropicCodeExecutionToolResultError = Readonly<{
  type: string;
  error_code?: string;
}>;

type AnthropicCodeExecutionToolResultBlock = Readonly<{
  type: string;
  tool_use_id: string;
  content: AnthropicCodeExecutionResultBlock | AnthropicCodeExecutionToolResultError;
}>;

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicServerToolUseBlock
  | AnthropicWebSearchToolResultBlock
  | AnthropicCodeExecutionToolResultBlock
  | Readonly<{ type: string }>;

type AnthropicFinalMessage = Readonly<{
  content: ReadonlyArray<AnthropicContentBlock>;
  stop_reason: string | null;
}>;

type AnthropicMessageParam = Readonly<{
  role: "user" | "assistant";
  content: string | ReadonlyArray<Readonly<Record<string, unknown>>>;
}>;

type AnthropicStreamLike = AsyncIterable<AnthropicAIChatStreamEvent> & Readonly<{
  finalMessage: () => Promise<AnthropicFinalMessage>;
}>;

type AnthropicMessagesClient = Readonly<{
  beta: Readonly<{
    files: AnthropicFileUploadClient;
    messages: Readonly<{
      stream: (body: Readonly<Record<string, unknown>>) => AnthropicStreamLike;
    }>;
  }>;
}>;

type AIChatLogEvent =
  | Readonly<{
    action: "request";
    requestId: string;
    model: string;
    messageCount: number;
  }>
  | Readonly<{
    action: "stream_opened";
    requestId: string;
    model: string;
    attempt: number;
  }>
  | Readonly<{
    action: "tool_call_validated";
    requestId: string;
    model: string;
    toolName: string;
    toolCallId: string;
  }>
  | Readonly<{
    action: "repair_attempt";
    requestId: string;
    model: string;
    attempt: number;
    maxAttempts: number;
    toolName: string | null;
    details: string;
  }>
  | Readonly<{
    action: "repair_exhausted";
    requestId: string;
    model: string;
    toolName: string | null;
  }>
  | Readonly<{
    action: "stream_closed";
    requestId: string;
    model: string;
    attempt: number;
    deltaCount: number;
    toolCallCount: number;
  }>;

type RepairPromptState = Readonly<{
  assistantText: string;
  prompt: string;
}>;

type UploadedFileRef = Readonly<{
  fileId: string;
  fileName: string;
}>;

type UploadPlan = Readonly<{
  latestUserIndex: number;
  uploadedParts: ReadonlyMap<string, UploadedFileRef>;
}>;

type ValidatedToolCall = Readonly<{
  toolCallId: string;
  name: string;
  input: string;
}>;

export type StreamAIChatTurnParams = Readonly<{
  messages: ReadonlyArray<AIChatWireMessage>;
  model: string;
  timezone: string;
  devicePlatform: "ios" | "android" | "web";
  chatSessionId: string;
  codeInterpreterContainerId: string | null;
  userContext: AIChatUserContext;
  providerSafetyUserId?: string | null;
  requestId: string;
  requestUrl: string;
  userId: string;
  workspaceId: string;
  selectedWorkspaceId: string | null;
  onUsage?: (usage: AIChatProviderUsage) => Promise<void>;
}>;

export type PreparedAIChatTurn = Readonly<{
  codeInterpreterContainerId: string | null;
  stream: AsyncGenerator<AIChatTurnStreamEvent>;
}>;

export class AIChatRuntimeError extends Error {
  readonly code: string;
  readonly stage: string;

  constructor(message: string, code: string, stage: string) {
    super(message);
    this.code = code;
    this.stage = stage;
  }
}

function logAIChatEvent(event: AIChatLogEvent): void {
  console.error(JSON.stringify({
    domain: "chat",
    vendor: "anthropic",
    mode: "backend_chat",
    ...event,
  }));
}

function createClient(): AnthropicMessagesClient {
  return new Anthropic() as unknown as AnthropicMessagesClient;
}

function isAnthropicTextDeltaEvent(
  event: AnthropicAIChatStreamEvent,
): event is AnthropicTextDeltaEvent {
  return event.type === "content_block_delta";
}

function isAnthropicContentBlockStartEvent(
  event: AnthropicAIChatStreamEvent,
): event is AnthropicContentBlockStartEvent {
  return event.type === "content_block_start";
}

function anthropicAIChatTools(): ReadonlyArray<Readonly<Record<string, unknown>>> {
  return [
    ...OPENAI_AI_CHAT_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Readonly<Record<string, unknown>>,
    })),
    {
      type: "code_execution_20250825",
      name: "code_execution",
    },
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 5,
    },
  ];
}

function parseToolInput(rawInput: string): unknown {
  return JSON.parse(rawInput) as unknown;
}

function latestUserMessageIndex(messages: ReadonlyArray<AIChatMessage>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

function isUploadableFileMessagePart(message: AIChatMessage, partIndex: number): boolean {
  if (message.role !== "user") {
    return false;
  }

  const part = message.content[partIndex];
  return part?.type === "file" && part.mediaType !== "application/pdf";
}

async function uploadLatestUserFiles(
  client: AnthropicMessagesClient,
  messages: ReadonlyArray<AIChatMessage>,
): Promise<UploadPlan> {
  const latestUserIndex = latestUserMessageIndex(messages);
  if (latestUserIndex < 0) {
    return {
      latestUserIndex,
      uploadedParts: new Map<string, UploadedFileRef>(),
    };
  }

  const latestUserMessage = messages[latestUserIndex];
  if (latestUserMessage === undefined || latestUserMessage.role !== "user") {
    return {
      latestUserIndex: -1,
      uploadedParts: new Map<string, UploadedFileRef>(),
    };
  }

  const uploadedEntries: Array<readonly [string, UploadedFileRef]> = [];

  for (let index = 0; index < latestUserMessage.content.length; index += 1) {
    if (isUploadableFileMessagePart(latestUserMessage, index) === false) {
      continue;
    }

    const part = latestUserMessage.content[index];
    if (part === undefined || part.type !== "file") {
      continue;
    }

    const uploadedFile = await client.beta.files.upload({
      file: await toFile(Buffer.from(part.base64Data, "base64"), part.fileName, { type: part.mediaType }),
      betas: [FILES_BETA],
    });

    uploadedEntries.push([
      `${latestUserIndex}:${index}`,
      {
        fileId: uploadedFile.id,
        fileName: part.fileName,
      },
    ]);
  }

  return {
    latestUserIndex,
    uploadedParts: new Map<string, UploadedFileRef>(uploadedEntries),
  };
}

function assertImageMediaType(mediaType: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  if (mediaType === "image/jpeg" || mediaType === "image/png" || mediaType === "image/gif" || mediaType === "image/webp") {
    return mediaType;
  }

  throw new AIChatRuntimeError(
    `Unsupported image media type for Anthropic AI chat: ${mediaType}`,
    "LOCAL_ATTACHMENT_UNSUPPORTED",
    "attachment_mapping",
  );
}

function mapLatestUserPartToAnthropicContentBlocks(
  message: Extract<AIChatMessage, { role: "user" }>,
  messageIndex: number,
  partIndex: number,
  uploadPlan: UploadPlan,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const part = message.content[partIndex];
  if (part === undefined) {
    throw new AIChatRuntimeError(
      `Missing message part at index ${partIndex}`,
      "LOCAL_ATTACHMENT_UNSUPPORTED",
      "attachment_mapping",
    );
  }

  if (part.type === "text") {
    return [{ type: "text", text: part.text }];
  }

  if (part.type === "image") {
    return [{
      type: "image",
      source: {
        type: "base64",
        media_type: assertImageMediaType(part.mediaType),
        data: part.base64Data,
      },
    }];
  }

  if (part.type === "file") {
    if (part.mediaType === "application/pdf") {
      return [{
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: part.base64Data,
        },
        title: part.fileName,
      }];
    }

    const uploadedPart = uploadPlan.uploadedParts.get(`${messageIndex}:${partIndex}`);
    if (uploadedPart === undefined) {
      throw new AIChatRuntimeError(
        `Missing uploaded file for ${part.fileName}`,
        "LOCAL_FILE_UPLOAD_MISSING",
        "file_upload",
      );
    }

    const blocks: Array<Readonly<Record<string, unknown>>> = [{
      type: "container_upload",
      file_id: uploadedPart.fileId,
    }];
    const inlineAttachmentContext = buildInlineTextAttachmentContext(part);
    if (inlineAttachmentContext !== null) {
      blocks.push({
        type: "text",
        text: inlineAttachmentContext,
      });
    }

    return blocks;
  }

  throw new AIChatRuntimeError(
    `Unsupported user content part: ${part.type}`,
    "LOCAL_ATTACHMENT_UNSUPPORTED",
    "attachment_mapping",
  );
}

function assistantTextContent(message: Extract<AIChatMessage, { role: "assistant" }>): string {
  return summarizeAIChatContentParts(message.content);
}

function messageToAnthropicMessage(
  message: AIChatMessage,
  messageIndex: number,
  uploadPlan: UploadPlan,
): AnthropicMessageParam | null {
  if (message.role === "user") {
    if (uploadPlan.latestUserIndex !== messageIndex) {
      const summarizedContent = summarizeAIChatContentParts(message.content);
      return summarizedContent === ""
        ? null
        : {
          role: "user",
          content: summarizedContent,
        };
    }

    const content = message.content.flatMap((_, partIndex) =>
      mapLatestUserPartToAnthropicContentBlocks(message, messageIndex, partIndex, uploadPlan),
    );

    return content.length === 0
      ? null
      : {
        role: "user",
        content,
      };
  }

  if (message.role === "assistant") {
    const content: Array<Readonly<Record<string, unknown>>> = [];
    const text = assistantTextContent(message);
    if (text !== "") {
      content.push({
        type: "text",
        text,
      });
    }

    for (const toolCall of extractAIChatAssistantToolCalls(message.content)) {
      content.push({
        type: "tool_use",
        id: toolCall.toolCallId,
        name: toolCall.name,
        input: parseToolInput(toolCall.input),
      });
    }

    return content.length === 0
      ? null
      : {
        role: "assistant",
        content,
      };
  }

  return {
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: message.toolCallId,
      content: message.output,
    }],
  };
}

function buildInput(
  messages: ReadonlyArray<AIChatMessage>,
  uploadPlan: UploadPlan,
  repairState: RepairPromptState | null,
): ReadonlyArray<AnthropicMessageParam> {
  const items: Array<AnthropicMessageParam> = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }

    const mappedMessage = messageToAnthropicMessage(message, index, uploadPlan);
    if (mappedMessage !== null) {
      items.push(mappedMessage);
    }
  }

  if (repairState === null) {
    return items;
  }

  if (repairState.assistantText !== "") {
    items.push({
      role: "assistant",
      content: repairState.assistantText,
    });
  }

  items.push({
    role: "user",
    content: repairState.prompt,
  });

  return items;
}

function isAIChatToolUseBlock(block: AnthropicContentBlock): block is AnthropicToolUseBlock {
  return block.type === "tool_use" && "name" in block && typeof block.name === "string" && isAIChatToolName(block.name);
}

function isServerToolUseBlock(block: AnthropicContentBlock): block is AnthropicServerToolUseBlock {
  return block.type === "server_tool_use";
}

function isWebSearchToolResultBlock(block: AnthropicContentBlock): block is AnthropicWebSearchToolResultBlock {
  return block.type === "web_search_tool_result";
}

function isCodeExecutionToolResultBlock(block: AnthropicContentBlock): block is AnthropicCodeExecutionToolResultBlock {
  return CODE_EXECUTION_RESULT_TYPES.has(block.type);
}

function normalizeToolCall(
  toolCall: AnthropicToolUseBlock,
  params: Readonly<{ requestId: string; model: string }>,
): ValidatedToolCall {
  const normalizedToolCall = toAIChatAssistantToolCall(
    toolCall.id,
    toolCall.name,
    JSON.stringify(toolCall.input),
  );
  logAIChatEvent({
    action: "tool_call_validated",
    requestId: params.requestId,
    model: params.model,
    toolName: toolCall.name,
    toolCallId: toolCall.id,
  });
  return {
    toolCallId: normalizedToolCall.toolCallId,
    name: normalizedToolCall.name,
    input: normalizedToolCall.input,
  };
}

function normalizeToolCalls(
  toolCalls: ReadonlyArray<AnthropicToolUseBlock>,
  params: Readonly<{ requestId: string; model: string }>,
): ReadonlyArray<AIChatAssistantToolCall> {
  return toolCalls.map((toolCall) => {
    const normalizedToolCall = normalizeToolCall(toolCall, params);
    return {
      toolCallId: normalizedToolCall.toolCallId,
      name: normalizedToolCall.name,
      input: normalizedToolCall.input,
    };
  });
}

function parseSqlToolInput(input: string): string {
  const parsed = JSON.parse(input) as Readonly<{ sql?: unknown }>;
  if (typeof parsed.sql !== "string" || parsed.sql.trim() === "") {
    throw new AIChatRuntimeError(
      "AI chat produced an invalid SQL tool payload.",
      "AI_CHAT_TOOL_INPUT_INVALID",
      "tool_execution",
    );
  }

  return parsed.sql;
}

function stringifyUnknown(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

function summarizeWebSearchResultContent(
  content: ReadonlyArray<AnthropicWebSearchResult> | AnthropicWebSearchToolResultError,
): string | null {
  if (Array.isArray(content) === false) {
    return JSON.stringify(content);
  }

  if (content.length === 0) {
    return null;
  }

  return content
    .map((result) => `${result.title} ${result.url}`)
    .join("\n");
}

function summarizeCodeExecutionResultContent(
  content: AnthropicCodeExecutionResultBlock | AnthropicCodeExecutionToolResultError,
): string | null {
  if ("stdout" in content || "stderr" in content || "return_code" in content) {
    const parts: Array<string> = [];

    if (typeof content.stdout === "string" && content.stdout !== "") {
      parts.push(content.stdout);
    }

    if (typeof content.stderr === "string" && content.stderr !== "") {
      parts.push(content.stderr);
    }

    if (typeof content.return_code === "number") {
      parts.push(`return_code=${content.return_code}`);
    }

    return parts.length === 0 ? null : parts.join("\n");
  }

  return JSON.stringify(content);
}

export function isSupportedAIChatModel(model: string): boolean {
  return AI_CHAT_MODEL_IDS.has(model);
}

export async function* streamAIChatAgentTurn(
  params: StreamAIChatTurnParams,
  client: AnthropicMessagesClient,
): AsyncGenerator<AIChatTurnStreamEvent> {
  logAIChatEvent({
    action: "request",
    requestId: params.requestId,
    model: params.model,
    messageCount: params.messages.length,
  });

  let repairState: RepairPromptState | null = null;
  let deltaCount = 0;
  const conversationMessages: Array<AIChatMessage> = params.messages.map((message) => {
    if (message.role === "user") {
      return message;
    }

    return {
      role: "assistant",
      content: message.content.filter((part) => part.type !== "tool_call"),
    } satisfies AIChatMessage;
  });
  const uploadPlan = await uploadLatestUserFiles(client, conversationMessages);

  for (let repairAttempt = 0; repairAttempt <= MAX_AI_CHAT_TOOL_REPAIR_ATTEMPTS; repairAttempt += 1) {
    let streamedAssistantText = "";
    logAIChatEvent({
      action: "stream_opened",
      requestId: params.requestId,
      model: params.model,
      attempt: repairAttempt + 1,
    });

    const providerToolNames = new Map<string, string>();
    const providerToolInputs = new Map<string, string | null>();
    const stream = client.beta.messages.stream({
      model: params.model,
      max_tokens: MAX_TOKENS,
      system: buildAIChatSystemInstructions(params.timezone, params.devicePlatform, params.userContext),
      messages: buildInput(conversationMessages, uploadPlan, repairState),
      ...(params.providerSafetyUserId === undefined || params.providerSafetyUserId === null
        ? {}
        : { metadata: { user_id: params.providerSafetyUserId } }),
      tools: anthropicAIChatTools(),
      betas: [FILES_BETA],
    });

    for await (const event of stream) {
      if (isAnthropicTextDeltaEvent(event) && event.delta.type === "text_delta") {
        deltaCount += 1;
        streamedAssistantText += event.delta.text;
        yield {
          type: "delta",
          text: event.delta.text,
        };
        continue;
      }

      if (isAnthropicContentBlockStartEvent(event) && event.content_block.type === "server_tool_use") {
        const serverToolBlock = event.content_block as AnthropicServerToolUseBlock;
        providerToolNames.set(serverToolBlock.id, serverToolBlock.name);
        providerToolInputs.set(serverToolBlock.id, stringifyUnknown(serverToolBlock.input));
        yield {
          type: "tool_call",
          toolCallId: serverToolBlock.id,
          name: serverToolBlock.name,
          status: "started",
          input: stringifyUnknown(serverToolBlock.input),
          output: null,
        };
      }
    }

    const finalMessage = await stream.finalMessage();

    for (const block of finalMessage.content) {
      if (isServerToolUseBlock(block)) {
        const serverToolBlock = block as AnthropicServerToolUseBlock;
        providerToolNames.set(serverToolBlock.id, serverToolBlock.name);
        providerToolInputs.set(serverToolBlock.id, stringifyUnknown(serverToolBlock.input));
        continue;
      }

      if (isWebSearchToolResultBlock(block)) {
        yield {
          type: "tool_call",
          toolCallId: block.tool_use_id,
          name: providerToolNames.get(block.tool_use_id) ?? "web_search",
          status: "completed",
          input: providerToolInputs.get(block.tool_use_id) ?? null,
          output: summarizeWebSearchResultContent(block.content),
        };
        continue;
      }

      if (isCodeExecutionToolResultBlock(block)) {
        yield {
          type: "tool_call",
          toolCallId: block.tool_use_id,
          name: providerToolNames.get(block.tool_use_id) ?? "code_execution",
          status: "completed",
          input: providerToolInputs.get(block.tool_use_id) ?? null,
          output: summarizeCodeExecutionResultContent(block.content),
        };
      }
    }

    const toolCalls = finalMessage.content.filter(isAIChatToolUseBlock);

    if (toolCalls.length === 0) {
      logAIChatEvent({
        action: "stream_closed",
        requestId: params.requestId,
        model: params.model,
        attempt: repairAttempt + 1,
        deltaCount,
        toolCallCount: 0,
      });
      yield { type: "done" };
      return;
    }

    try {
      const normalizedToolCalls = normalizeToolCalls(toolCalls, {
        requestId: params.requestId,
        model: params.model,
      });
      logAIChatEvent({
        action: "stream_closed",
        requestId: params.requestId,
        model: params.model,
        attempt: repairAttempt + 1,
        deltaCount,
        toolCallCount: normalizedToolCalls.length,
      });

      if (normalizedToolCalls.length === 0) {
        yield { type: "done" };
        return;
      }

      const toolOutputsById = new Map<string, string>();
      for (const toolCall of normalizedToolCalls) {
        yield {
          type: "tool_call_request",
          toolCallId: toolCall.toolCallId,
          name: toolCall.name,
          input: toolCall.input,
        };

        yield {
          type: "tool_call",
          toolCallId: toolCall.toolCallId,
          name: toolCall.name,
          status: "started",
          input: toolCall.input,
          output: null,
        };

        const toolOutput = await executeAIChatSqlTool({
          requestUrl: params.requestUrl,
          requestId: params.requestId,
          userId: params.userId,
          workspaceId: params.workspaceId,
          selectedWorkspaceId: params.selectedWorkspaceId,
          devicePlatform: params.devicePlatform,
        }, parseSqlToolInput(toolCall.input));
        toolOutputsById.set(toolCall.toolCallId, toolOutput);

        yield {
          type: "tool_call",
          toolCallId: toolCall.toolCallId,
          name: toolCall.name,
          status: "completed",
          input: toolCall.input,
          output: toolOutput,
        };
      }

      const assistantContent = [
        ...(streamedAssistantText === ""
          ? []
          : [{ type: "text", text: streamedAssistantText }] as const),
        ...buildAssistantToolCallContentParts(normalizedToolCalls, toolOutputsById),
      ];

      if (assistantContent.length > 0) {
        conversationMessages.push({
          role: "assistant",
          content: assistantContent,
        });
      }

      for (const toolCall of normalizedToolCalls) {
        const output = toolOutputsById.get(toolCall.toolCallId);
        if (output === undefined) {
          throw new AIChatRuntimeError(
            `Missing backend tool output for ${toolCall.toolCallId}`,
            "AI_CHAT_TOOL_OUTPUT_MISSING",
            "tool_execution",
          );
        }

        conversationMessages.push({
          role: "tool",
          toolCallId: toolCall.toolCallId,
          name: toolCall.name,
          output,
        });
      }

      repairState = null;
      continue;
    } catch (error) {
      if (isRepairableToolCallError(error) === false) {
        throw error;
      }

      if (repairAttempt >= MAX_AI_CHAT_TOOL_REPAIR_ATTEMPTS) {
        logAIChatEvent({
          action: "repair_exhausted",
          requestId: params.requestId,
          model: params.model,
          toolName: error.toolName,
        });
        throw new AIChatRuntimeError(
          "Assistant could not prepare a valid tool call. Try again.",
          "LOCAL_TOOL_CALL_INVALID",
          "tool_call_validation",
        );
      }

      const nextAttempt = repairAttempt + 1;
      logAIChatEvent({
        action: "repair_attempt",
        requestId: params.requestId,
        model: params.model,
        attempt: nextAttempt,
        maxAttempts: MAX_AI_CHAT_TOOL_REPAIR_ATTEMPTS,
        toolName: error.toolName,
        details: error.rawDetails,
      });
      repairState = {
        assistantText: streamedAssistantText,
        prompt: error.repairPrompt,
      };
      yield makeAIChatRepairStatusEvent(nextAttempt, error.toolName);
    }
  }

  throw new AIChatRuntimeError(
    "Assistant could not prepare a valid tool call. Try again.",
    "LOCAL_TOOL_CALL_INVALID",
    "tool_call_validation",
  );
}

export async function* streamAIChatTurn(
  params: StreamAIChatTurnParams,
): AsyncGenerator<AIChatTurnStreamEvent> {
  yield* streamAIChatAgentTurn(params, createClient());
}

export async function prepareAIChatTurn(
  params: StreamAIChatTurnParams,
): Promise<PreparedAIChatTurn> {
  return {
    codeInterpreterContainerId: null,
    stream: streamAIChatTurn(params),
  };
}
