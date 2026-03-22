import { Buffer } from "node:buffer";
import OpenAI, { toFile } from "openai";
import packageJson from "../../../package.json";
import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";
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
  isSpreadsheetFile,
  isAIChatToolName,
  isRepairableToolCallError,
  makeAIChatRepairStatusEvent,
  MAX_AI_CHAT_TOOL_REPAIR_ATTEMPTS,
  summarizeAIChatContentParts,
  toAIChatAssistantToolCall,
} from "../aiChatRuntimeShared";
import { executeAIChatSqlTool } from "../aiChatToolExecutor";
import { OPENAI_AI_CHAT_TOOLS } from "./aiChatTools";

const AI_CHAT_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.2",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
]);
const OPENAI_SDK_VERSION = packageJson.dependencies.openai;

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
    type: "message";
    role: "assistant";
    content: ReadonlyArray<
      | Readonly<{
        type: "output_text";
        text: string;
        annotations: ReadonlyArray<
          | Readonly<{
            type: "container_file_citation";
            container_id: string;
            file_id: string;
            filename: string;
            start_index: number;
            end_index: number;
          }>
          | Readonly<{ type: string }>
        >;
      }>
      | Readonly<{
        type: "refusal";
        refusal: string;
      }>
      | Readonly<{ type: string }>
    >;
  }>
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
    create?: (
      body: Readonly<{
        name: string;
        expires_after: Readonly<{
          anchor: "last_active_at";
          minutes: number;
        }>;
      }>,
    ) => Promise<Readonly<{
      id: string;
      name: string;
      status: string;
    }>>;
    retrieve?: (
      containerID: string,
    ) => Promise<Readonly<{
      id: string;
      name: string;
      status: string;
    }>>;
    files: Readonly<{
      create?: (
        containerID: string,
        body: Readonly<{ file_id: string }>,
      ) => Promise<Readonly<{
        id: string;
        path: string;
        source: string;
        bytes: number;
      }>>;
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

type AIChatLogEvent =
  | Readonly<{
    action: "request";
    requestId: string;
    model: string;
    chatSessionId: string;
    incomingCodeInterpreterContainerId: string | null;
    messageCount: number;
    attachmentCount: number;
    spreadsheetAttachmentCount: number;
    attachmentFileNames: ReadonlyArray<string>;
    attachmentMediaTypes: ReadonlyArray<string>;
    forcedToolChoice: "auto" | "code_interpreter";
  }>
  | Readonly<{
    action: "client_initialized";
    requestId: string;
    model: string;
    chatSessionId: string;
    sdkVersion: string;
    hasResponses: boolean;
    hasResponsesStream: boolean;
    hasFiles: boolean;
    hasContainers: boolean;
    hasContainerFiles: boolean;
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
  }>
  | Readonly<{
    action: "code_interpreter_container_created";
    requestId: string;
    model: string;
    chatSessionId: string;
    containerId: string;
    containerName: string;
  }>
  | Readonly<{
    action: "code_interpreter_container_reused";
    requestId: string;
    model: string;
    chatSessionId: string;
    containerId: string;
    containerName: string;
  }>
  | Readonly<{
    action: "code_interpreter_container_recreated";
    requestId: string;
    model: string;
    chatSessionId: string;
    previousContainerId: string | null;
    previousReason: string;
    containerId: string;
    containerName: string;
  }>
  | Readonly<{
    action: "code_interpreter_container_session_mismatch";
    requestId: string;
    model: string;
    chatSessionId: string;
    containerId: string;
    expectedContainerName: string;
    actualContainerName: string;
  }>
  | Readonly<{
    action: "code_interpreter_container_file_added";
    requestId: string;
    model: string;
    chatSessionId: string;
    containerId: string;
    fileId: string;
    containerFileId: string;
    containerFilePath: string;
    bytes: number;
  }>
  | Readonly<{
    action: "code_interpreter_container_inventory";
    requestId: string;
    model: string;
    chatSessionId: string;
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
    action: "response_summary";
    requestId: string;
    model: string;
    chatSessionId: string;
    effectiveCodeInterpreterContainerId: string | null;
    finalOutputItemTypes: ReadonlyArray<string>;
    hasCodeInterpreterCall: boolean;
    codeInterpreterCallCount: number;
    codeSnippet: string | null;
    outputSummary: string | null;
    assistantTextSnippet: string | null;
    containerFileCitations: ReadonlyArray<Readonly<{
      containerId: string;
      fileId: string;
      filename: string;
    }>>;
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

type CodeInterpreterContainerPlan = Readonly<{
  effectiveContainerId: string | null;
  shouldUseExplicitContainer: boolean;
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

const CODE_INTERPRETER_CONTAINER_EXPIRY_MINUTES = 20;
const LOG_SNIPPET_MAX_CHARS = 400;

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
    vendor: "openai",
    mode: "backend_chat",
    ...event,
  }));
}

function createClient(): OpenAIResponsesClient {
  return new OpenAI();
}

function logOpenAIClientInitialization(
  params: Readonly<{
    requestId: string;
    model: string;
    chatSessionId: string;
  }>,
  client: OpenAIResponsesClient,
): void {
  logAIChatEvent({
    action: "client_initialized",
    requestId: params.requestId,
    model: params.model,
    chatSessionId: params.chatSessionId,
    sdkVersion: OPENAI_SDK_VERSION,
    hasResponses: client.responses !== undefined,
    hasResponsesStream: typeof client.responses?.stream === "function",
    hasFiles: typeof client.files.create === "function",
    hasContainers: client.containers !== undefined,
    hasContainerFiles: client.containers?.files !== undefined,
  });
}

function assertOpenAIResponsesClient(
  params: Readonly<{
    requestId: string;
    model: string;
    chatSessionId: string;
  }>,
  client: OpenAIResponsesClient,
): void {
  logOpenAIClientInitialization(params, client);

  if (typeof client.responses?.stream !== "function") {
    throw new AIChatRuntimeError(
      "AI chat OpenAI client is misconfigured on this server.",
      "LOCAL_CHAT_CLIENT_INVALID",
      "client_setup",
    );
  }
}

function codeInterpreterContainerName(chatSessionId: string): string {
  return `flashcards-local-chat-${chatSessionId}`;
}

function truncateForLog(value: string | null, maxChars: number): string | null {
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return null;
  }

  if (trimmedValue.length <= maxChars) {
    return trimmedValue;
  }

  return `${trimmedValue.slice(0, maxChars)}...`;
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

function isMessageOutputItem(
  item: OpenAIOutputItem,
): item is Extract<OpenAIOutputItem, { type: "message" }> {
  return item.type === "message";
}

function summarizeFinalResponse(
  finalResponse: Readonly<{
    output: ReadonlyArray<OpenAIOutputItem>;
  }>,
): Readonly<{
  finalOutputItemTypes: ReadonlyArray<string>;
  hasCodeInterpreterCall: boolean;
  codeInterpreterCallCount: number;
  codeSnippet: string | null;
  outputSummary: string | null;
  assistantTextSnippet: string | null;
  containerFileCitations: ReadonlyArray<Readonly<{
    containerId: string;
    fileId: string;
    filename: string;
  }>>;
}> {
  const codeInterpreterCalls = finalResponse.output.filter(isCodeInterpreterCallOutputItem);
  const assistantTextParts: Array<string> = [];
  const containerFileCitations: Array<Readonly<{
    containerId: string;
    fileId: string;
    filename: string;
  }>> = [];

  for (const item of finalResponse.output) {
    if (isMessageOutputItem(item) === false) {
      continue;
    }

    if (Array.isArray(item.content) === false) {
      continue;
    }

    for (const contentItem of item.content) {
      if (contentItem.type !== "output_text") {
        continue;
      }

      assistantTextParts.push(contentItem.text);
      for (const annotation of contentItem.annotations) {
        if (annotation.type !== "container_file_citation") {
          continue;
        }

        containerFileCitations.push({
          containerId: annotation.container_id,
          fileId: annotation.file_id,
          filename: annotation.filename,
        });
      }
    }
  }

  return {
    finalOutputItemTypes: finalResponse.output.map((item) => item.type),
    hasCodeInterpreterCall: codeInterpreterCalls.length > 0,
    codeInterpreterCallCount: codeInterpreterCalls.length,
    codeSnippet: truncateForLog(codeInterpreterCalls[0]?.code ?? null, LOG_SNIPPET_MAX_CHARS),
    outputSummary: truncateForLog(
      summarizeCodeInterpreterOutputs(codeInterpreterCalls[0]?.outputs ?? null),
      LOG_SNIPPET_MAX_CHARS,
    ),
    assistantTextSnippet: truncateForLog(assistantTextParts.join("\n"), LOG_SNIPPET_MAX_CHARS),
    containerFileCitations,
  };
}

function latestUserMessageIndex(
  messages: ReadonlyArray<AIChatMessage>,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

function latestUserAttachments(messages: ReadonlyArray<AIChatMessage>): ReadonlyArray<LatestUserAttachmentSummary> {
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
    logAIChatEvent({
      action: "spreadsheet_attachment_without_code_interpreter",
      requestId: params.requestId,
      model: params.model,
      attachmentFileNames: params.spreadsheetAttachmentFileNames,
    });
    return;
  }

  if (client.containers?.files.list === undefined) {
    logAIChatEvent({
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

      logAIChatEvent({
        action: "spreadsheet_container_verified",
        requestId: params.requestId,
        model: params.model,
        containerId: toolCall.container_id,
        containerFileCount: containerFiles.length,
        containerFiles,
      });
    } catch (error) {
      logAIChatEvent({
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
  messages: ReadonlyArray<AIChatMessage>,
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

async function logCodeInterpreterContainerInventory(
  client: OpenAIResponsesClient,
  params: Readonly<{
    requestId: string;
    model: string;
    chatSessionId: string;
    containerId: string;
  }>,
): Promise<void> {
  const containerFiles = (await client.containers?.files.list(params.containerId))?.data.map((file) => ({
    id: file.id,
    path: file.path,
    source: file.source,
    bytes: file.bytes,
  })) ?? [];

  logAIChatEvent({
    action: "code_interpreter_container_inventory",
    requestId: params.requestId,
    model: params.model,
    chatSessionId: params.chatSessionId,
    containerId: params.containerId,
    containerFileCount: containerFiles.length,
    containerFiles,
  });
}

async function resolveCodeInterpreterContainer(
  client: OpenAIResponsesClient,
  params: StreamAIChatTurnParams,
  uploadPlan: UploadPlan,
): Promise<CodeInterpreterContainerPlan> {
  const shouldUseExplicitContainer = uploadPlan.uploadedFileIds.length > 0
    || params.codeInterpreterContainerId !== null;

  if (shouldUseExplicitContainer === false) {
    return {
      effectiveContainerId: null,
      shouldUseExplicitContainer,
    };
  }

  if (
    client.containers?.create === undefined
    || client.containers.retrieve === undefined
    || client.containers.files.create === undefined
    || client.containers.files.list === undefined
  ) {
    throw new AIChatRuntimeError(
      "AI chat code execution is unavailable on this server.",
      "LOCAL_CHAT_CONTAINER_UNAVAILABLE",
      "container_setup",
    );
  }

  const expectedContainerName = codeInterpreterContainerName(params.chatSessionId);
  let effectiveContainerId: string | null = null;
  let recreationReason: string | null = null;

  if (params.codeInterpreterContainerId !== null) {
    try {
      const existingContainer = await client.containers.retrieve(params.codeInterpreterContainerId);
      if (existingContainer.name !== expectedContainerName) {
        logAIChatEvent({
          action: "code_interpreter_container_session_mismatch",
          requestId: params.requestId,
          model: params.model,
          chatSessionId: params.chatSessionId,
          containerId: params.codeInterpreterContainerId,
          expectedContainerName,
          actualContainerName: existingContainer.name,
        });
        recreationReason = "session_mismatch";
      } else if (existingContainer.status !== "active") {
        recreationReason = `status_${existingContainer.status}`;
      } else {
        effectiveContainerId = existingContainer.id;
        logAIChatEvent({
          action: "code_interpreter_container_reused",
          requestId: params.requestId,
          model: params.model,
          chatSessionId: params.chatSessionId,
          containerId: existingContainer.id,
          containerName: existingContainer.name,
        });
      }
    } catch (error) {
      recreationReason = error instanceof Error ? error.name : "retrieve_failed";
    }
  }

  if (effectiveContainerId === null) {
    const createdContainer = await client.containers.create({
      name: expectedContainerName,
      expires_after: {
        anchor: "last_active_at",
        minutes: CODE_INTERPRETER_CONTAINER_EXPIRY_MINUTES,
      },
    });
    effectiveContainerId = createdContainer.id;

    if (recreationReason === null) {
      logAIChatEvent({
        action: "code_interpreter_container_created",
        requestId: params.requestId,
        model: params.model,
        chatSessionId: params.chatSessionId,
        containerId: createdContainer.id,
        containerName: createdContainer.name,
      });
    } else {
      logAIChatEvent({
        action: "code_interpreter_container_recreated",
        requestId: params.requestId,
        model: params.model,
        chatSessionId: params.chatSessionId,
        previousContainerId: params.codeInterpreterContainerId,
        previousReason: recreationReason,
        containerId: createdContainer.id,
        containerName: createdContainer.name,
      });
    }
  }

  for (const fileId of uploadPlan.uploadedFileIds) {
    const containerFile = await client.containers.files.create(effectiveContainerId, { file_id: fileId });
    logAIChatEvent({
      action: "code_interpreter_container_file_added",
      requestId: params.requestId,
      model: params.model,
      chatSessionId: params.chatSessionId,
      containerId: effectiveContainerId,
      fileId,
      containerFileId: containerFile.id,
      containerFilePath: containerFile.path,
      bytes: containerFile.bytes,
    });
  }

  await logCodeInterpreterContainerInventory(client, {
    requestId: params.requestId,
    model: params.model,
    chatSessionId: params.chatSessionId,
    containerId: effectiveContainerId,
  });

  return {
    effectiveContainerId,
    shouldUseExplicitContainer,
  };
}

function assistantTextContent(message: Extract<AIChatMessage, { role: "assistant" }>): string {
  return summarizeAIChatContentParts(message.content);
}

function messageToResponseItems(
  message: AIChatMessage,
  messageIndex: number,
  uploadPlan: UploadPlan,
): ReadonlyArray<ResponseInputItem> {
  if (message.role === "user") {
    if (uploadPlan.latestUserIndex !== messageIndex) {
      const summarizedContent = summarizeAIChatContentParts(message.content);
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

    for (const toolCall of extractAIChatAssistantToolCalls(message.content)) {
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
  messages: ReadonlyArray<AIChatMessage>,
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
  const normalizedToolCall = toAIChatAssistantToolCall(toolCall.call_id, toolCall.name, toolCall.arguments);
  logAIChatEvent({
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
): ReadonlyArray<AIChatAssistantToolCall> {
  return toolCalls
    .filter((toolCall) => isAIChatToolName(toolCall.name))
    .map((toolCall) => normalizeToolCall(toolCall, params));
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

export function isSupportedAIChatModel(model: string): boolean {
  return AI_CHAT_MODEL_IDS.has(model);
}

async function* streamPreparedAIChatAgentTurn(
  params: StreamAIChatTurnParams,
  client: OpenAIResponsesClient,
  uploadPlan: UploadPlan,
  attachmentSummaries: ReadonlyArray<LatestUserAttachmentSummary>,
  containerPlan: CodeInterpreterContainerPlan,
): AsyncGenerator<AIChatTurnStreamEvent> {
  const spreadsheetAttachments = attachmentSummaries.filter((attachment) => attachment.isSpreadsheet);
  const forcedToolChoice = spreadsheetAttachments.length > 0 ? "code_interpreter" : "auto";
  const shouldLogResponseSummary = attachmentSummaries.length > 0
    || params.codeInterpreterContainerId !== null
    || containerPlan.effectiveContainerId !== null;

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

  for (let repairAttempt = 0; repairAttempt <= MAX_AI_CHAT_TOOL_REPAIR_ATTEMPTS; repairAttempt += 1) {
    let streamedAssistantText = "";
    logAIChatEvent({
      action: "stream_opened",
      requestId: params.requestId,
      model: params.model,
      attempt: repairAttempt + 1,
    });

    const startedProviderTools = new Set<string>();
    const stream = client.responses.stream({
      model: params.model,
      instructions: buildAIChatSystemInstructions(params.timezone, params.devicePlatform, params.userContext),
      input: buildInput(conversationMessages, uploadPlan, repairState),
      ...(forcedToolChoice === "code_interpreter"
        ? { tool_choice: { type: "code_interpreter" as const } }
        : {}),
      ...(params.providerSafetyUserId === undefined || params.providerSafetyUserId === null
        ? {}
        : { safety_identifier: params.providerSafetyUserId }),
      tools: [
        ...OPENAI_AI_CHAT_TOOLS,
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
          container: containerPlan.shouldUseExplicitContainer && containerPlan.effectiveContainerId !== null
            ? containerPlan.effectiveContainerId
            : {
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
    const usage = (finalResponse as Readonly<{
      usage?: Readonly<{
        input_tokens?: number;
        output_tokens?: number;
      }>;
    }>).usage;
    if (
      usage !== undefined
      && typeof usage.input_tokens === "number"
      && typeof usage.output_tokens === "number"
      && params.onUsage !== undefined
    ) {
      await params.onUsage({
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      });
    }
    if (shouldLogResponseSummary) {
      const responseSummary = summarizeFinalResponse(finalResponse);
      logAIChatEvent({
        action: "response_summary",
        requestId: params.requestId,
        model: params.model,
        chatSessionId: params.chatSessionId,
        effectiveCodeInterpreterContainerId: containerPlan.effectiveContainerId,
        finalOutputItemTypes: responseSummary.finalOutputItemTypes,
        hasCodeInterpreterCall: responseSummary.hasCodeInterpreterCall,
        codeInterpreterCallCount: responseSummary.codeInterpreterCallCount,
        codeSnippet: responseSummary.codeSnippet,
        outputSummary: responseSummary.outputSummary,
        assistantTextSnippet: responseSummary.assistantTextSnippet,
        containerFileCitations: responseSummary.containerFileCitations,
      });
    }
    await verifySpreadsheetContainers(client, {
      requestId: params.requestId,
      model: params.model,
      spreadsheetAttachmentFileNames: spreadsheetAttachments.map((attachment) => attachment.fileName),
    }, finalResponse);
    const toolCalls = finalResponse.output.filter(isFunctionToolCall);

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

async function prepareAIChatAgentTurn(
  params: StreamAIChatTurnParams,
  client: OpenAIResponsesClient,
): Promise<PreparedAIChatTurn> {
  assertOpenAIResponsesClient(params, client);
  const attachmentSummaries = latestUserAttachments(params.messages);
  logAIChatEvent({
    action: "request",
    requestId: params.requestId,
    model: params.model,
    chatSessionId: params.chatSessionId,
    incomingCodeInterpreterContainerId: params.codeInterpreterContainerId,
    messageCount: params.messages.length,
    attachmentCount: attachmentSummaries.length,
    spreadsheetAttachmentCount: attachmentSummaries.filter((attachment) => attachment.isSpreadsheet).length,
    attachmentFileNames: attachmentSummaries.map((attachment) => attachment.fileName),
    attachmentMediaTypes: attachmentSummaries.map((attachment) => attachment.mediaType),
    forcedToolChoice: attachmentSummaries.some((attachment) => attachment.isSpreadsheet) ? "code_interpreter" : "auto",
  });

  const uploadPlan = await uploadLatestUserFiles(client, params.messages);
  const containerPlan = await resolveCodeInterpreterContainer(client, params, uploadPlan);

  return {
    codeInterpreterContainerId: containerPlan.effectiveContainerId,
    stream: streamPreparedAIChatAgentTurn(
      params,
      client,
      uploadPlan,
      attachmentSummaries,
      containerPlan,
    ),
  };
}

export async function* streamAIChatAgentTurn(
  params: StreamAIChatTurnParams,
  client: OpenAIResponsesClient,
): AsyncGenerator<AIChatTurnStreamEvent> {
  const preparedTurn = await prepareAIChatAgentTurn(params, client);
  yield* preparedTurn.stream;
}

export async function* streamAIChatTurn(
  params: StreamAIChatTurnParams,
): AsyncGenerator<AIChatTurnStreamEvent> {
  const preparedTurn = await prepareAIChatAgentTurn(params, createClient());
  yield* preparedTurn.stream;
}

export async function prepareAIChatTurn(
  params: StreamAIChatTurnParams,
): Promise<PreparedAIChatTurn> {
  return prepareAIChatAgentTurn(params, createClient());
}
