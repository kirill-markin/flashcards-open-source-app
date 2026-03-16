import { Buffer } from "node:buffer";
import OpenAI, { toFile } from "openai";
import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type {
  LocalAssistantToolCall,
  LocalChatMessage,
  LocalChatStreamEvent,
  LocalChatUserContext,
} from "../localTypes";
import {
  buildInlineTextAttachmentContext,
  buildLocalSystemInstructions,
  extractLocalAssistantToolCalls,
  isSpreadsheetFile,
  isLocalToolName,
  isRepairableToolCallError,
  makeLocalRepairStatusEvent,
  MAX_LOCAL_TOOL_REPAIR_ATTEMPTS,
  summarizeLocalContentParts,
  toLocalAssistantToolCall,
} from "../localRuntimeShared";
import { OPENAI_LOCAL_FLASHCARDS_TOOLS } from "./localTools";

const LOCAL_CHAT_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.2",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
]);

type OpenAIToolEvent =
  | Readonly<{
    type: "response.output_text.delta";
    delta?: string;
  }>
  | Readonly<{
    type: "response.web_search_call.in_progress" | "response.web_search_call.searching";
    item_id: string;
  }>
  | Readonly<{
    type: "response.code_interpreter_call.in_progress" | "response.code_interpreter_call.interpreting";
    item_id: string;
  }>
  | Readonly<{
    type: "response.output_item.done";
    item: OpenAIOutputItem;
  }>
  | Readonly<{ type: string }>;

type OpenAITextDeltaEvent = Extract<OpenAIToolEvent, { type: "response.output_text.delta" }>;
type OpenAIWebSearchProgressEvent = Extract<
  OpenAIToolEvent,
  { type: "response.web_search_call.in_progress" | "response.web_search_call.searching" }
>;
type OpenAICodeInterpreterProgressEvent = Extract<
  OpenAIToolEvent,
  { type: "response.code_interpreter_call.in_progress" | "response.code_interpreter_call.interpreting" }
>;
type OpenAIOutputItemDoneEvent = Extract<OpenAIToolEvent, { type: "response.output_item.done" }>;

type OpenAIOutputItem =
  | ResponseFunctionToolCall
  | Readonly<{
    id: string;
    type: "web_search_call";
    action?: Readonly<Record<string, unknown>>;
  }>
  | Readonly<{
    id: string;
    type: "code_interpreter_call";
    code: string | null;
    container_id: string;
    outputs: ReadonlyArray<
      | Readonly<{ type: "logs"; logs: string }>
      | Readonly<{ type: "image"; url: string }>
      | Readonly<{ type: string }>
    > | null;
  }>
  | Readonly<{ type: string; id?: string }>;

type ResponseStreamLike = AsyncIterable<OpenAIToolEvent> & Readonly<{
  finalResponse: () => Promise<Readonly<{
    output: ReadonlyArray<OpenAIOutputItem>;
  }>>;
}>;

type OpenAIResponsesClient = Readonly<{
  containers?: Readonly<{
    files: Readonly<{
      list: (
        containerID: string,
      ) => Promise<Readonly<{ data: ReadonlyArray<Readonly<{
        id: string;
        path: string;
        source: string;
        bytes: number;
      }>> }>>;
    }>;
  }>;
  files: Readonly<{
    create: (
      body: Readonly<{ file: File; purpose: "user_data" }>,
    ) => Promise<Readonly<{ id: string; filename: string }>>;
  }>;
  responses: Readonly<{
    stream: (body: Readonly<Record<string, unknown>>) => ResponseStreamLike;
  }>;
}>;

type LocalChatLogEvent =
  | Readonly<{
    action: "request";
    requestId: string;
    model: string;
    messageCount: number;
    attachmentCount: number;
    spreadsheetAttachmentCount: number;
    attachmentFileNames: ReadonlyArray<string>;
    attachmentMediaTypes: ReadonlyArray<string>;
    forcedToolChoice: "auto" | "code_interpreter";
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
  }>
  | Readonly<{
    action: "spreadsheet_attachment_without_code_interpreter";
    requestId: string;
    model: string;
    attachmentFileNames: ReadonlyArray<string>;
  }>
  | Readonly<{
    action: "spreadsheet_container_verified";
    requestId: string;
    model: string;
    containerId: string;
    containerFileCount: number;
    containerFiles: ReadonlyArray<Readonly<{
      id: string;
      path: string;
      source: string;
      bytes: number;
    }>>;
  }>
  | Readonly<{
    action: "spreadsheet_container_verification_failed";
    requestId: string;
    model: string;
    containerId: string;
    errorName: string;
    errorMessage: string;
  }>
  | Readonly<{
    action: "spreadsheet_container_verification_unavailable";
    requestId: string;
    model: string;
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
  uploadedFileIds: ReadonlyArray<string>;
}>;

type ValidatedToolCall = Readonly<{
  toolCallId: string;
  name: string;
  input: string;
}>;

type LatestUserAttachmentSummary = Readonly<{
  fileName: string;
  mediaType: string;
  bytes: number;
  isSpreadsheet: boolean;
}>;

export type StreamLocalTurnParams = Readonly<{
  messages: ReadonlyArray<LocalChatMessage>;
  model: string;
  timezone: string;
  devicePlatform: "ios" | "web";
  userContext: LocalChatUserContext;
  providerSafetyUserId?: string | null;
  requestId: string;
}>;

export class LocalChatRuntimeError extends Error {
  readonly code: string;
  readonly stage: string;

  constructor(message: string, code: string, stage: string) {
    super(message);
    this.code = code;
    this.stage = stage;
  }
}

function logLocalChatEvent(event: LocalChatLogEvent): void {
  console.error(JSON.stringify({
    domain: "chat",
    vendor: "openai",
    mode: "local_client",
    ...event,
  }));
}

function createClient(): OpenAIResponsesClient {
  return new OpenAI();
}

function isOpenAITextDeltaEvent(event: OpenAIToolEvent): event is OpenAITextDeltaEvent {
  return event.type === "response.output_text.delta";
}

function isOpenAIWebSearchProgressEvent(
  event: OpenAIToolEvent,
): event is OpenAIWebSearchProgressEvent {
  return event.type === "response.web_search_call.in_progress" || event.type === "response.web_search_call.searching";
}

function isOpenAICodeInterpreterProgressEvent(
  event: OpenAIToolEvent,
): event is OpenAICodeInterpreterProgressEvent {
  return event.type === "response.code_interpreter_call.in_progress"
    || event.type === "response.code_interpreter_call.interpreting";
}

function isOpenAIOutputItemDoneEvent(event: OpenAIToolEvent): event is OpenAIOutputItemDoneEvent {
  return event.type === "response.output_item.done";
}

function isFunctionToolCall(
  item: Readonly<{ type: string }>,
): item is ResponseFunctionToolCall {
  return item.type === "function_call";
}

function isWebSearchCallOutputItem(
  item: OpenAIOutputItem,
): item is Extract<OpenAIOutputItem, { type: "web_search_call" }> {
  return item.type === "web_search_call";
}

function isCodeInterpreterCallOutputItem(
  item: OpenAIOutputItem,
): item is Extract<OpenAIOutputItem, { type: "code_interpreter_call" }> {
  return item.type === "code_interpreter_call";
}

function latestUserMessageIndex(
  messages: ReadonlyArray<LocalChatMessage>,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

function latestUserAttachments(messages: ReadonlyArray<LocalChatMessage>): ReadonlyArray<LatestUserAttachmentSummary> {
  const latestUserIndex = latestUserMessageIndex(messages);
  if (latestUserIndex < 0) {
    return [];
  }

  const latestUserMessage = messages[latestUserIndex];
  if (latestUserMessage === undefined || latestUserMessage.role !== "user") {
    return [];
  }

  return latestUserMessage.content.flatMap((part) => {
    if (part.type !== "file" && part.type !== "image") {
      return [];
    }

    return [{
      fileName: part.type === "file" ? part.fileName : "image",
      mediaType: part.mediaType,
      bytes: Buffer.from(part.base64Data, "base64").byteLength,
      isSpreadsheet: part.type === "file" && isSpreadsheetFile(part.mediaType, part.fileName),
    }];
  });
}

async function verifySpreadsheetContainers(
  client: OpenAIResponsesClient,
  params: Readonly<{
    requestId: string;
    model: string;
    spreadsheetAttachmentFileNames: ReadonlyArray<string>;
  }>,
  finalResponse: Readonly<{
    output: ReadonlyArray<OpenAIOutputItem>;
  }>,
): Promise<void> {
  if (params.spreadsheetAttachmentFileNames.length === 0) {
    return;
  }

  const codeInterpreterCalls = finalResponse.output.filter(isCodeInterpreterCallOutputItem);
  if (codeInterpreterCalls.length === 0) {
    logLocalChatEvent({
      action: "spreadsheet_attachment_without_code_interpreter",
      requestId: params.requestId,
      model: params.model,
      attachmentFileNames: params.spreadsheetAttachmentFileNames,
    });
    return;
  }

  if (client.containers?.files.list === undefined) {
    logLocalChatEvent({
      action: "spreadsheet_container_verification_unavailable",
      requestId: params.requestId,
      model: params.model,
    });
    return;
  }

  const seenContainerIds = new Set<string>();

  for (const toolCall of codeInterpreterCalls) {
    if (seenContainerIds.has(toolCall.container_id)) {
      continue;
    }

    seenContainerIds.add(toolCall.container_id);

    try {
      const page = await client.containers.files.list(toolCall.container_id);
      const containerFiles = page.data.map((file) => ({
        id: file.id,
        path: file.path,
        source: file.source,
        bytes: file.bytes,
      }));

      logLocalChatEvent({
        action: "spreadsheet_container_verified",
        requestId: params.requestId,
        model: params.model,
        containerId: toolCall.container_id,
        containerFileCount: containerFiles.length,
        containerFiles,
      });
    } catch (error) {
      logLocalChatEvent({
        action: "spreadsheet_container_verification_failed",
        requestId: params.requestId,
        model: params.model,
        containerId: toolCall.container_id,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function uploadLatestUserFiles(
  client: OpenAIResponsesClient,
  messages: ReadonlyArray<LocalChatMessage>,
): Promise<UploadPlan> {
  const latestUserIndex = latestUserMessageIndex(messages);
  if (latestUserIndex < 0) {
    return {
      latestUserIndex,
      uploadedParts: new Map<string, UploadedFileRef>(),
      uploadedFileIds: [],
    };
  }

  const latestUserMessage = messages[latestUserIndex];
  if (latestUserMessage === undefined || latestUserMessage.role !== "user") {
    return {
      latestUserIndex: -1,
      uploadedParts: new Map<string, UploadedFileRef>(),
      uploadedFileIds: [],
    };
  }

  const uploadedEntries: Array<readonly [string, UploadedFileRef]> = [];
  const uploadedFileIds: Array<string> = [];

  for (let index = 0; index < latestUserMessage.content.length; index += 1) {
    const part = latestUserMessage.content[index];
    if (part?.type !== "image" && part?.type !== "file") {
      continue;
    }

    const uploadedFile = await client.files.create({
      file: await toFile(
        Buffer.from(part.base64Data, "base64"),
        part.type === "file" ? part.fileName : `image-${index}.${part.mediaType.split("/")[1] ?? "bin"}`,
        { type: part.mediaType },
      ),
      purpose: "user_data",
    });

    uploadedEntries.push([
      `${latestUserIndex}:${index}`,
      {
        fileId: uploadedFile.id,
        fileName: uploadedFile.filename,
      },
    ]);
    uploadedFileIds.push(uploadedFile.id);
  }

  return {
    latestUserIndex,
    uploadedParts: new Map<string, UploadedFileRef>(uploadedEntries),
    uploadedFileIds,
  };
}

function assistantTextContent(message: Extract<LocalChatMessage, { role: "assistant" }>): string {
  return summarizeLocalContentParts(message.content);
}

function messageToResponseItems(
  message: LocalChatMessage,
  messageIndex: number,
  uploadPlan: UploadPlan,
): ReadonlyArray<ResponseInputItem> {
  if (message.role === "user") {
    if (uploadPlan.latestUserIndex !== messageIndex) {
      const summarizedContent = summarizeLocalContentParts(message.content);
      return summarizedContent === ""
        ? []
        : [{
          type: "message",
          role: "user",
          content: summarizedContent,
        } satisfies ResponseInputItem];
    }

    const content: Array<Readonly<Record<string, unknown>>> = [];
    for (let index = 0; index < message.content.length; index += 1) {
      const part = message.content[index];
      if (part?.type === "text") {
        content.push({
          type: "input_text",
          text: part.text,
        });
        continue;
      }

      const uploadedPart = uploadPlan.uploadedParts.get(`${messageIndex}:${index}`);
      if (uploadedPart === undefined) {
        continue;
      }

      if (part?.type === "image") {
        content.push({
          type: "input_image",
          detail: "auto",
          file_id: uploadedPart.fileId,
        });
        continue;
      }

      if (part?.type === "file") {
        content.push({
          type: "input_file",
          file_id: uploadedPart.fileId,
        });

        const inlineAttachmentContext = buildInlineTextAttachmentContext(part);
        if (inlineAttachmentContext !== null) {
          content.push({
            type: "input_text",
            text: inlineAttachmentContext,
          });
        }
      }
    }

    return content.length === 0
      ? []
      : [{
        type: "message",
        role: "user",
        content,
      } as unknown as ResponseInputItem];
  }

  if (message.role === "assistant") {
    const items: Array<ResponseInputItem> = [];
    const text = assistantTextContent(message);
    if (text !== "") {
      items.push({
        type: "message",
        role: "assistant",
        content: text,
      });
    }

    for (const toolCall of extractLocalAssistantToolCalls(message.content)) {
      items.push({
        type: "function_call",
        call_id: toolCall.toolCallId,
        name: toolCall.name,
        arguments: toolCall.input,
      });
    }

    return items;
  }

  return [{
    type: "function_call_output",
    call_id: message.toolCallId,
    output: message.output,
  }];
}

function buildInput(
  messages: ReadonlyArray<LocalChatMessage>,
  uploadPlan: UploadPlan,
  repairState: RepairPromptState | null,
): ReadonlyArray<ResponseInputItem> {
  const items: Array<ResponseInputItem> = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message !== undefined) {
      items.push(...messageToResponseItems(message, index, uploadPlan));
    }
  }

  if (repairState === null) {
    return items;
  }

  if (repairState.assistantText !== "") {
    items.push({
      type: "message",
      role: "assistant",
      content: repairState.assistantText,
    });
  }

  items.push({
    type: "message",
    role: "user",
    content: repairState.prompt,
  });

  return items;
}

function normalizeToolCall(
  toolCall: ResponseFunctionToolCall,
  params: Readonly<{ requestId: string; model: string }>,
): ValidatedToolCall {
  const normalizedToolCall = toLocalAssistantToolCall(toolCall.call_id, toolCall.name, toolCall.arguments);
  logLocalChatEvent({
    action: "tool_call_validated",
    requestId: params.requestId,
    model: params.model,
    toolName: toolCall.name,
    toolCallId: toolCall.call_id,
  });
  return {
    toolCallId: normalizedToolCall.toolCallId,
    name: normalizedToolCall.name,
    input: normalizedToolCall.input,
  };
}

function normalizeToolCalls(
  toolCalls: ReadonlyArray<ResponseFunctionToolCall>,
  params: Readonly<{ requestId: string; model: string }>,
): ReadonlyArray<LocalAssistantToolCall> {
  return toolCalls
    .filter((toolCall) => isLocalToolName(toolCall.name))
    .map((toolCall) => normalizeToolCall(toolCall, params));
}

function summarizeWebSearchAction(action: Readonly<Record<string, unknown>> | undefined): string | null {
  if (action === undefined) {
    return null;
  }

  return JSON.stringify(action);
}

function summarizeCodeInterpreterOutputs(
  outputs: ReadonlyArray<
    | Readonly<{ type: "logs"; logs: string }>
    | Readonly<{ type: "image"; url: string }>
    | Readonly<{ type: string }>
  > | null,
): string | null {
  if (outputs === null || outputs.length === 0) {
    return null;
  }

  const parts: Array<string> = [];
  for (const output of outputs) {
    if (output.type === "logs" && "logs" in output) {
      parts.push(output.logs);
      continue;
    }

    if (output.type === "image" && "url" in output) {
      parts.push(output.url);
    }
  }

  return parts.length === 0 ? null : parts.join("\n");
}

export function isSupportedLocalChatModel(model: string): boolean {
  return LOCAL_CHAT_MODEL_IDS.has(model);
}

export async function* streamLocalAgentTurn(
  params: StreamLocalTurnParams,
  client: OpenAIResponsesClient,
): AsyncGenerator<LocalChatStreamEvent> {
  const attachmentSummaries = latestUserAttachments(params.messages);
  const spreadsheetAttachments = attachmentSummaries.filter((attachment) => attachment.isSpreadsheet);
  const forcedToolChoice = spreadsheetAttachments.length > 0 ? "code_interpreter" : "auto";

  logLocalChatEvent({
    action: "request",
    requestId: params.requestId,
    model: params.model,
    messageCount: params.messages.length,
    attachmentCount: attachmentSummaries.length,
    spreadsheetAttachmentCount: spreadsheetAttachments.length,
    attachmentFileNames: attachmentSummaries.map((attachment) => attachment.fileName),
    attachmentMediaTypes: attachmentSummaries.map((attachment) => attachment.mediaType),
    forcedToolChoice,
  });

  let repairState: RepairPromptState | null = null;
  let streamedAssistantText = "";
  let deltaCount = 0;
  const uploadPlan = await uploadLatestUserFiles(client, params.messages);

  for (let repairAttempt = 0; repairAttempt <= MAX_LOCAL_TOOL_REPAIR_ATTEMPTS; repairAttempt += 1) {
    logLocalChatEvent({
      action: "stream_opened",
      requestId: params.requestId,
      model: params.model,
      attempt: repairAttempt + 1,
    });

    const startedProviderTools = new Set<string>();
    const stream = client.responses.stream({
      model: params.model,
      instructions: buildLocalSystemInstructions(params.timezone, params.devicePlatform, params.userContext),
      input: buildInput(params.messages, uploadPlan, repairState),
      ...(forcedToolChoice === "code_interpreter"
        ? { tool_choice: { type: "code_interpreter" as const } }
        : {}),
      ...(params.providerSafetyUserId === undefined || params.providerSafetyUserId === null
        ? {}
        : { safety_identifier: params.providerSafetyUserId }),
      tools: [
        ...OPENAI_LOCAL_FLASHCARDS_TOOLS,
        {
          type: "web_search",
          search_context_size: "medium",
          user_location: {
            type: "approximate",
            timezone: params.timezone,
          },
        },
        {
          type: "code_interpreter",
          container: {
            type: "auto",
            file_ids: uploadPlan.uploadedFileIds,
          },
        },
      ],
      parallel_tool_calls: false,
    });

    for await (const event of stream) {
      if (isOpenAITextDeltaEvent(event) && event.delta !== undefined) {
        deltaCount += 1;
        streamedAssistantText += event.delta;
        yield { type: "delta", text: event.delta };
        continue;
      }

      if (isOpenAIWebSearchProgressEvent(event) && startedProviderTools.has(event.item_id) === false) {
        startedProviderTools.add(event.item_id);
        yield {
          type: "tool_call",
          toolCallId: event.item_id,
          name: "web_search",
          status: "started",
          input: null,
          output: null,
        };
        continue;
      }

      if (isOpenAICodeInterpreterProgressEvent(event) && startedProviderTools.has(event.item_id) === false) {
        startedProviderTools.add(event.item_id);
        yield {
          type: "tool_call",
          toolCallId: event.item_id,
          name: "code_interpreter",
          status: "started",
          input: null,
          output: null,
        };
        continue;
      }

      if (isOpenAIOutputItemDoneEvent(event)) {
        if (isWebSearchCallOutputItem(event.item)) {
          yield {
            type: "tool_call",
            toolCallId: event.item.id,
            name: "web_search",
            status: "completed",
            input: null,
            output: summarizeWebSearchAction(event.item.action),
          };
          continue;
        }

        if (isCodeInterpreterCallOutputItem(event.item)) {
          yield {
            type: "tool_call",
            toolCallId: event.item.id,
            name: "code_interpreter",
            status: "completed",
            input: event.item.code,
            output: summarizeCodeInterpreterOutputs(event.item.outputs),
          };
        }
      }
    }

    const finalResponse = await stream.finalResponse();
    await verifySpreadsheetContainers(client, {
      requestId: params.requestId,
      model: params.model,
      spreadsheetAttachmentFileNames: spreadsheetAttachments.map((attachment) => attachment.fileName),
    }, finalResponse);
    const toolCalls = finalResponse.output.filter(isFunctionToolCall);

    if (toolCalls.length === 0) {
      logLocalChatEvent({
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

      logLocalChatEvent({
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

      for (const toolCall of normalizedToolCalls) {
        yield {
          type: "tool_call_request",
          toolCallId: toolCall.toolCallId,
          name: toolCall.name,
          input: toolCall.input,
        };
      }

      yield { type: "await_tool_results" };
      return;
    } catch (error) {
      if (isRepairableToolCallError(error) === false) {
        throw error;
      }

      if (repairAttempt >= MAX_LOCAL_TOOL_REPAIR_ATTEMPTS) {
        logLocalChatEvent({
          action: "repair_exhausted",
          requestId: params.requestId,
          model: params.model,
          toolName: error.toolName,
        });
        throw new LocalChatRuntimeError(
          "Assistant could not prepare a valid tool call. Try again.",
          "LOCAL_TOOL_CALL_INVALID",
          "tool_call_validation",
        );
      }

      const nextAttempt = repairAttempt + 1;
      logLocalChatEvent({
        action: "repair_attempt",
        requestId: params.requestId,
        model: params.model,
        attempt: nextAttempt,
        maxAttempts: MAX_LOCAL_TOOL_REPAIR_ATTEMPTS,
        toolName: error.toolName,
        details: error.rawDetails,
      });
      repairState = {
        assistantText: streamedAssistantText,
        prompt: error.repairPrompt,
      };
      yield makeLocalRepairStatusEvent(nextAttempt, error.toolName);
    }
  }

  throw new LocalChatRuntimeError(
    "Assistant could not prepare a valid tool call. Try again.",
    "LOCAL_TOOL_CALL_INVALID",
    "tool_call_validation",
  );
}

export async function* streamLocalTurn(
  params: StreamLocalTurnParams,
): AsyncGenerator<LocalChatStreamEvent> {
  yield* streamLocalAgentTurn(params, createClient());
}
